import { initEconomy } from "../data/Economy";
import { initFuelPrices } from "../data/FuelPrices";
import { initWeather } from "../data/Weather";
import { TICK_MS } from "../Constants";
import { waitForLoad } from "../helpers/WaitForLoad";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  matchScenario,
  pauseWorld,
  restoreWorld,
  savedMatchSpec,
  stepWorld,
} from "../multiplayer/World";
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
let busy = false;
let faulted = false;
let lastControlHeartbeat = performance.now();
let lastSave = 0;
let timer: ReturnType<typeof setTimeout>;
let viewTimer: ReturnType<typeof setTimeout> | undefined;
let viewDue = Infinity;
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
function publish() {
  clearTimeout(viewTimer);
  viewTimer = undefined;
  viewDue = Infinity;
  if (!world) return;
  const views = publication.take(world, performance.now());
  if (Object.keys(views).length) post({ kind: "views", views });
}
function requestViews(options?: Parameters<ViewPublication["request"]>[2]) {
  if (!world) return;
  const now = performance.now();
  const delay = publication.request(world, now, options);
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
  clearTimeout(timer);
  clearInterval(keepaliveTimer);
  post({
    kind: "error",
    message: error instanceof Error ? error.message : "Simulation error",
  });
  if (!world) return;
  pauseWorld(
    world,
    "The simulation stopped. Resume the last saved match in a new lobby.",
  );
  try {
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
      pauseWorld(
        world,
        "The host stopped responding. Everyone must be ready before resuming.",
      );
    }
    stepWorld(world);
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
async function startMatch(
  request: Extract<WorkerRequest, { kind: "create" | "restore" }>,
) {
  busy = true;
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
  busy = false;
  requestViews({ force: true });
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
function handle(request: WorkerRequest, running: World) {
  if (request.kind === "command") {
    const previousSpeed = running.speed;
    const error = applyCommand(
      running,
      request.sender,
      request.envelope,
      request.allowReady,
    );
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
      pauseWorld(
        running,
        `${running.seats.find((s) => s.id === request.sender)?.name || "A player"} disconnected. Reconnect before resuming.`,
      );
    // Connection membership is attached by the renderer, outside the world revision/key.
    requestViews({ force: true });
  } else if (request.kind === "checkpoint") {
    if (request.pause) {
      pauseWorld(running, "Host saved and stopped the match");
    }
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
      clearInterval(keepaliveTimer);
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
