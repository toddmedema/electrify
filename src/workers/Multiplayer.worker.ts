import { installSimulationHooks } from "../achievements/SimulationHooks";
import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { TICK_MS } from "../Constants";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { waitForLoad } from "../helpers/WaitForLoad";
import {
  checkpointWorld,
  createWorld,
  matchScenario,
  restoreWorld,
  savedMatchSpec,
  worldBlockers,
} from "../multiplayer/World";
import { ReplicatedWorld } from "../multiplayer/Replication";
import type { ReplicaRecord } from "../multiplayer/Replication";
import { ReplicaRecovery } from "../multiplayer/ReplicaRecovery";
import { fitsJsonShape } from "../multiplayer/TurnWire";
import { encodeWire } from "../multiplayer/WireJson";
import { ViewPublication } from "../multiplayer/ViewPublication";
import {
  CHECKPOINT_INTERVAL_MS,
  CONTROL_HEARTBEAT_TIMEOUT_MS,
  HOST_KEEPALIVE_MS,
} from "../multiplayer/Timing";
import type { MatchSpec, World } from "../multiplayer/Types";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../multiplayer/WorkerProtocol";

const worker = globalThis as unknown as Worker;
let world: World | undefined;
let local = false;
let replicated: ReplicatedWorld | undefined;
let hostSeat: string | undefined;
let recovery: ReplicaRecovery | undefined;
let online = false;
let replicationOpen = true;
let requestedMembership: string[] | undefined;
let authority: Extract<WorkerRequest, { kind: "heartbeat" }>["authority"];
let authorityPaused = false;

function hasAuthority(epoch: string) {
  return (
    !online ||
    (authority?.epoch === epoch &&
      performance.timeOrigin + performance.now() <
        authority.monotonicDeadline &&
      Date.now() < authority.wallDeadline)
  );
}

function openReplication(running: World) {
  if (replicationOpen || !requestedMembership || !hasAuthority(running.epoch))
    return;
  const connected = requestedMembership;
  requestedMembership = undefined;
  replicationOpen = true;
  recovery?.connected(connected);
  for (const to of connected) sendBaseline(to);
}

function enforceAuthority(running: World) {
  if (hasAuthority(running.epoch)) {
    authorityPaused = false;
    return true;
  }
  if (!authorityPaused) {
    authorityPaused = true;
    replicated!.pause(
      "Host authority was interrupted. Reconnect and ready up before resuming.",
    );
    requestRecords(true);
    requestViews({ force: true });
  }
  return false;
}

let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let recordTimer: ReturnType<typeof setTimeout> | undefined;
let recordDue = Infinity;
let flushedIndex = 0;
let busy = false;
let faulted = false;
let lastControlHeartbeat = performance.now();
let lastSave = 0;
let timer: ReturnType<typeof setTimeout>;
let viewTimer: ReturnType<typeof setTimeout> | undefined;
let viewDue = Infinity;
let viewPending = false;
let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
const publication = new ViewPublication();
const post = (event: WorkerResponse) => worker.postMessage(event);
/** Every company plays the scenario's own location, so one weather series serves them all. */
async function data(spec: MatchSpec) {
  const { location } = matchScenario(spec);
  await Promise.all([
    waitForLoad(initEconomy),
    waitForLoad(initFuelPrices),
    waitForLoad((done) => initWeather(location, done)),
  ]);
}
function flushRecords() {
  clearTimeout(recordTimer);
  recordTimer = undefined;
  recordDue = Infinity;
  if (!replicated || !world) return;
  const batch = replicated.drain();
  if (!batch) return;
  flushedIndex = replicated.index;
  if (local) return;
  let from = batch.from;
  let records: ReplicaRecord[] = [];
  const message = (items: ReplicaRecord[]) => ({
    kind: "records" as const,
    matchId: world!.matchId,
    epoch: world!.epoch,
    from,
    records: items,
  });
  const fits = (items: ReplicaRecord[]) => {
    const json = encodeWire(message(items));
    return (
      new TextEncoder().encode(json).byteLength <= maxRecordBytes &&
      (!online || fitsJsonShape(json, 47, 8188))
    );
  };
  // Leave room for the generation and epoch in the TURN packet envelope.
  const maxRecordBytes = online ? 60 * 1024 : 64 * 1024;
  for (const record of batch.records) {
    if (
      records.length &&
      (records.length === 256 || !fits([...records, record]))
    ) {
      post(message(records));
      from += records.length;
      records = [];
    }
    if (!records.length && !fits([record]))
      throw new Error("A multiplayer record exceeds the network limit");
    records.push(record);
  }
  if (records.length) post(message(records));
}
function requestRecords(urgent = false) {
  if (!replicated || replicated.index <= flushedIndex) return;
  // Couch play shares the worker and does not need a network record log.
  if (local) return flushRecords();
  const delay = urgent ? 0 : 100;
  const due = performance.now() + delay;
  if (recordDue <= due) return;
  clearTimeout(recordTimer);
  recordDue = due;
  recordTimer = setTimeout(() => {
    try {
      flushRecords();
    } catch (error) {
      fault(error);
    }
  }, delay);
}
function sendBaseline(to: string) {
  if (replicationOpen && recovery?.baseline(to)) requestViews({ force: true });
}
/** Flush due seat projections and report a local summary from the same authoritative world.
 * Its date follows an active company, or the latest retired grid once the whole match has ended. */
function publish() {
  clearTimeout(viewTimer);
  viewTimer = undefined;
  viewDue = Infinity;
  if (!world) return;
  const views = publication.take(
    world,
    performance.now(),
    !local && hostSeat ? [hostSeat] : undefined,
  );
  if (Object.keys(views).length) {
    viewPending = true;
    post({ kind: "views", views });
    if (local) {
      const match = world;
      // A retired P1 freezes. The shared calendar must follow a company still playing.
      const game =
        match.grids.find((_grid, i) => !match.outcomes[match.seats[i].id]) ||
        match.grids.reduce((latest, grid) =>
          grid.date.minute > latest.date.minute ? grid : latest,
        );
      post({
        kind: "summary",
        summary: {
          matchId: match.matchId,
          epoch: match.epoch,
          revision: match.revision,
          date: game.date,
          speed: match.speed,
          reason: match.reason,
          systemBlockers: worldBlockers(match),
          readyRequired: match.readyRequired,
          ready: [...match.ready],
          players: match.seats.map((seat, index) => {
            const retired = !!match.outcomes[seat.id];
            return {
              ...seat,
              selectedSpeed: match.selectedSpeeds[seat.id],
              pauseReason: match.activities[seat.id],
              pendingChoice:
                match.speed === "PAUSED" && !retired
                  ? pendingScenarioChoice(match.grids[index])?.title
                  : undefined,
              retired,
            };
          }),
          complete: match.seats.every((seat) => !!match.outcomes[seat.id]),
          outcomes: match.outcomes,
        },
      });
    }
  }
}
function requestViews(options?: Parameters<ViewPublication["request"]>[2]) {
  if (!world) return;
  const now = performance.now();
  const delay = publication.request(world, now, options);
  // The worker can outrun a busy renderer even at five Hz. Keep changes/receipts in the
  // publication until the previous bundle is consumed, rather than queueing cloned grids.
  if (viewPending) return;
  if (delay === undefined) return;
  if (delay === 0) return publish();
  if (viewDue <= now + delay) return;
  clearTimeout(viewTimer);
  viewDue = now + delay;
  viewTimer = setTimeout(publish, Math.ceil(delay));
}
/** A running match that throws stops for everyone with an explanation, never silently. */
function fault(error: unknown) {
  faulted = true;
  recovery?.stop();
  clearTimeout(timer);
  clearInterval(keepaliveTimer);
  clearInterval(recoveryTimer);
  post({
    kind: "error",
    message: error instanceof Error ? error.message : "Simulation error",
  });
  if (!world) return;
  replicated!.pause(
    "The simulation stopped. Resume the last saved match in a new lobby.",
  );
  replicated!.fault(
    error instanceof Error ? error.message : "Simulation error",
  );
  try {
    flushRecords();
    requestViews({ force: true });
  } catch {
    // The host already has the error; a world that cannot render has nothing to publish.
  }
}
function loop() {
  if (!world) return;
  const started = performance.now();
  try {
    if (
      !world.paused &&
      started - lastControlHeartbeat > CONTROL_HEARTBEAT_TIMEOUT_MS
    ) {
      replicated!.pause(
        "The host stopped responding. Everyone must be ready before resuming.",
      );
      requestRecords(true);
    }
    if (enforceAuthority(world)) replicated!.step();
    requestRecords();
    requestViews();
    if (started - lastSave >= CHECKPOINT_INTERVAL_MS) {
      post({ kind: "checkpoint", world: checkpointWorld(world) });
      lastSave = started;
    }
  } catch (error) {
    fault(error);
    return;
  }
  // Never skip a tick, accumulate a sleep backlog, or block the renderer/native callback pump.
  timer = setTimeout(
    loop,
    Math.max(0, TICK_MS[world.speed] - (performance.now() - started)),
  );
}
/** Load simulation data before creating or restoring the worker-owned world.
 * Publish its baseline and checkpoint before scheduling ticks; local account hooks stay worker-owned. */
async function startMatch(
  request: Extract<WorkerRequest, { kind: "create" | "restore" }>,
) {
  busy = true;
  local = !!request.local;
  online = !request.local && !!request.online;
  replicationOpen = !online;
  if (local) {
    const { achievementHooks } = await import("../achievements/Achievements");
    installSimulationHooks(achievementHooks);
  }
  if (request.kind === "create") {
    await data(request.spec);
    world = createWorld(
      request.spec,
      request.seats,
      request.matchId,
      request.epoch,
    );
  } else {
    const spec = savedMatchSpec(request.world);
    await data(spec);
    world = restoreWorld(request.world, request.epoch, request.seats);
  }
  replicated = new ReplicatedWorld(world);
  hostSeat = request.hostSeat || world.seats[0].id;
  if (!local && !world.seats.some((seat) => seat.id === hostSeat))
    throw new Error("The host company is missing from the match");
  if (!local) {
    recovery = new ReplicaRecovery(replicated, hostSeat, {
      flush: flushRecords,
      send: (to, baseline) => post({ kind: "baseline", to, baseline }),
      changed: () => {
        requestRecords(true);
        requestViews();
      },
      error: fault,
      waitForDispatch: online,
    });
    recoveryTimer = setInterval(() => {
      try {
        if (replicationOpen) recovery!.pulse();
      } catch (error) {
        fault(error);
      }
    }, 100);
  }
  busy = false;
  requestViews({ force: true });
  if (!local) for (const seat of world.seats) sendBaseline(seat.id);
  post({ kind: "checkpoint", world: checkpointWorld(world) });
  lastSave = performance.now();
  keepaliveTimer = setInterval(() => {
    if (world && !faulted)
      post({
        kind: "keepalive",
        matchId: world.matchId,
        epoch: world.epoch,
        revision: world.revision,
      });
  }, HOST_KEEPALIVE_MS);
  loop();
}
/** Apply host requests in worker message order and publish the resulting command receipts.
 * Checkpoints follow previously accepted actions, with any requested pause applied before persistence. */
function handle(request: WorkerRequest, running: World) {
  if (request.kind === "blockers") {
    if (request.requireReady)
      replicated!.pause(
        request.readyReason ||
          request.reasons.join(" · ") ||
          "Ready up before resuming",
      );
    if (recovery) recovery.setShellBlockers(request.reasons);
    else replicated!.setBlockers(request.reasons);
    requestRecords(true);
    requestViews({ force: true });
  } else if (request.kind === "replication-open") {
    requestedMembership = request.connected;
    openReplication(running);
  } else if (request.kind === "command") {
    if (!replicationOpen || !enforceAuthority(running)) return;
    const previousSpeed = running.speed;
    const { error, recorded } = replicated!.command(
      request.sender,
      request.envelope,
      request.allowReady,
    );
    requestRecords(true);
    if (!local && error && !recorded)
      post({
        kind: "rejected",
        to: request.sender,
        matchId: running.matchId,
        epoch: running.epoch,
        sequence: request.envelope.sequence,
        error,
      });
    if (previousSpeed !== running.speed) {
      clearTimeout(timer);
      timer = setTimeout(loop, TICK_MS[running.speed]);
    }
    requestViews({
      urgent: true,
      receipt: {
        sender: request.sender,
        sequence: request.envelope.sequence,
        error,
      },
    });
  } else if (request.kind === "disconnect") {
    // A retired company no longer holds the clock, so its player may leave without a pause.
    if (!running.outcomes[request.sender])
      replicated!.pause(
        `${running.seats.find((s) => s.id === request.sender)?.name || "A player"} disconnected. Reconnect before resuming.`,
      );
    requestRecords(true);
    // Connection membership is attached by the renderer, outside the world revision/key.
    requestViews({ force: true });
  } else if (request.kind === "baseline") {
    sendBaseline(request.to);
  } else if (request.kind === "baseline-dispatched") {
    recovery?.dispatched(request.to, request.index, request.delivered);
  } else if (request.kind === "replica-peers") {
    if (requestedMembership) requestedMembership = request.connected;
    recovery?.connected(request.connected);
  } else if (request.kind === "progress") {
    if (replicationOpen) recovery?.progress(request);
  } else if (request.kind === "resync") {
    if (request.matchId === running.matchId && request.epoch === running.epoch)
      sendBaseline(request.sender);
  } else if (request.kind === "checkpoint") {
    if (request.pause) {
      replicated!.pause(
        request.suspended
          ? "A device went to sleep. Ready up before resuming."
          : "Host saved and stopped the match",
      );
    }
    requestRecords(true);
    // Reconnects need a full baseline even when a paused revision is unchanged.
    requestViews({ force: true });
    post({
      kind: "checkpoint",
      world: checkpointWorld(running),
      requestId: request.requestId,
    });
  }
}
const refuse = (message: string) => post({ kind: "error", message });
worker.onmessage = async ({ data: request }: MessageEvent<WorkerRequest>) => {
  if (request.kind === "heartbeat") {
    lastControlHeartbeat = performance.now();
    authority = request.authority;
    if (online && world && enforceAuthority(world)) openReplication(world);
    return;
  }
  if (request.kind === "views-applied") {
    if (viewPending) {
      viewPending = false;
      if (!local) publication.consumed(performance.now());
      // A fault can stop the tick loop while its final safety view is waiting for consumption.
      requestViews();
    }
    return;
  }
  if (request.kind === "create" || request.kind === "restore") {
    // A second start must not disturb the match that is already starting or running.
    if (busy || world) return refuse("A match is already running");
    try {
      await startMatch(request);
    } catch (error) {
      busy = false;
      if (world) return fault(error);
      clearTimeout(timer);
      clearTimeout(viewTimer);
      clearTimeout(recordTimer);
      clearInterval(keepaliveTimer);
      clearInterval(recoveryTimer);
      post({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not prepare the match",
      });
    }
    return;
  }
  if (!world) return refuse("Start a match first");
  if (faulted)
    return refuse("Resume the last complete multiplayer save in a new lobby");
  try {
    handle(request, world);
  } catch (error) {
    fault(error);
  }
};
export {};
