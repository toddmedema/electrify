import fs from "fs";
import { createHash } from "crypto";
import "../Store";
import { loadSimData } from "./SimData";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  roomView,
  stepWorld,
} from "../multiplayer/World";
import { COOP_TEST_SPEC, coopSeats } from "./MultiplayerFixtures";
import type { RoomView, World } from "../multiplayer/Types";
import type { SpeedType } from "../Types";
import { TICK_MS } from "../Constants";
import { ViewPublication } from "../multiplayer/ViewPublication";

const {
  encode,
  stringify,
  chunk,
  assemble,
  SteamMultiplayer,
} = require("../../electron/steam-multiplayer.cjs");
function median(values: number[]) {
  return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
}
function measure(payload: unknown) {
  let rawBytes = 0,
    wireBytes = 0;
  const encodes: number[] = [],
    decodes: number[] = [];
  for (let run = 0; run < 4; run++) {
    rawBytes = Buffer.byteLength(stringify(payload));
    let start = performance.now();
    const message = encode(payload);
    const encodedMs = performance.now() - start;
    const frames: Buffer[] = [];
    while (message.offset * 32768 < message.bytes.length) {
      frames.push(chunk(message));
      message.offset++;
    }
    wireBytes = frames.reduce((sum, frame) => sum + frame.length, 0);
    start = performance.now();
    const pending = new Map();
    let decoded: unknown;
    for (const frame of frames) decoded = assemble(pending, frame) || decoded;
    const decodedMs = performance.now() - start;
    expect(stringify(decoded)).toBe(stringify(payload));
    if (run > 0) {
      encodes.push(encodedMs);
      // Assertion comparison is excluded from the codec timing.
      decodes.push(decodedMs);
    }
  }
  return {
    rawBytes,
    wireBytes,
    encodeMs: median(encodes),
    decodeMs: median(decodes),
  };
}
/** Deterministic browser-timer cadence, without simulation/transport execution time.
 * The old publisher only checks inside loop(); the new publisher has its own deadline. */
function cadence(world: World, speed: SpeedType) {
  const target = { ...world, speed, paused: speed === "PAUSED" };
  const publication = new ViewPublication(() => ({}) as RoomView);
  publication.request(target, 0, { force: true });
  publication.take(target, 0);
  const tickMs = Math.floor(TICK_MS[speed]);
  let nextTick = tickMs,
    due = Infinity,
    lastLegacy = 0,
    legacy = 0,
    current = 0;
  while (Math.min(nextTick, due) <= 10000) {
    if (nextTick <= due) {
      const now = nextTick;
      nextTick += tickMs;
      if (speed !== "PAUSED") target.revision++;
      if (now - lastLegacy >= 100) {
        legacy++;
        lastLegacy = now;
      }
      const delay = publication.request(target, now);
      if (delay === 0) {
        publication.take(target, now);
        current++;
        due = Infinity;
      } else if (delay !== undefined)
        due = Math.min(due, now + Math.ceil(delay));
    } else {
      publication.take(target, due);
      current++;
      due = Infinity;
    }
  }
  return { speed, beforeHz: legacy / 10, afterHz: current / 10 };
}
/** Exercise the native checkpoint/send/receipt policy; disk IO is excluded from wire evidence. */
async function checkpointTraffic(world: World) {
  const host = Object.create(SteamMultiplayer.prototype);
  host.service = { identity: { steamId: world.seats[0].id } };
  host.hostId = world.seats[0].id;
  const connections = world.seats.slice(1).map((seat) => ({
    id: seat.id,
    connected: true,
    queue: [] as ReturnType<typeof encode>[],
  }));
  host.connections = new Map(
    connections.map((connection, i) => [i, connection]),
  );
  host.publish = () => {};
  host.state = () => ({});
  let localWrites = 0;
  host.persist = async (saved: World) => {
    host.savedAt = ++localWrites;
    return createHash("sha256").update(stringify(saved)).digest("hex");
  };
  const saved = checkpointWorld(world);
  async function publication(acknowledge: boolean) {
    await host.checkpoint(saved);
    let wireBytes = 0;
    for (const connection of host.connections.values()) {
      for (const message of connection.queue) {
        const incoming = new Map();
        let decoded: { world: World; digest: string } | undefined;
        while (message.offset * 32768 < message.bytes.length) {
          const frame = chunk(message);
          message.offset++;
          wireBytes += frame.length;
          decoded = assemble(incoming, frame) || decoded;
        }
        expect(stringify(decoded!.world)).toBe(stringify(saved));
        if (acknowledge)
          await host.receive(connection.id, {
            kind: "saved",
            digest: decoded!.digest,
          });
      }
      connection.queue = [];
    }
    return wireBytes;
  }
  const initialWireBytes = await publication(false);
  const unacknowledgedRetryWireBytes = await publication(true);
  const acknowledgedRepeatWireBytes = await publication(true);
  expect(unacknowledgedRetryWireBytes).toBe(initialWireBytes);
  expect(acknowledgedRepeatWireBytes).toBe(0);
  const reconnecting = connections[0];
  host.connections.set(0, { id: reconnecting.id, connected: true, queue: [] });
  const oneReconnectedPeerWireBytes = await publication(true);
  expect(oneReconnectedPeerWireBytes).toBe(
    initialWireBytes / connections.length,
  );
  expect(localWrites).toBe(4);
  return {
    initialWireBytes,
    unacknowledgedRetryWireBytes,
    acknowledgedRepeatWireBytes,
    oneReconnectedPeerWireBytes,
    localWrites,
  };
}
async function sample(world: World) {
  const cloneTimes: number[] = [];
  for (let run = 0; run < 4; run++) {
    const start = performance.now();
    world.seats.forEach((seat) => roomView(world, seat.id));
    if (run > 0) cloneTimes.push(performance.now() - start);
  }
  const views = world.seats
    .slice(1)
    .map((seat) => measure({ kind: "view", view: roomView(world, seat.id) }));
  const sum = (field: keyof (typeof views)[number]) =>
    views.reduce((total, view) => total + view[field], 0);
  const pulse = measure({
    kind: "keepalive",
    matchId: world.matchId,
    epoch: world.epoch,
    revision: world.revision,
  });
  const saved = checkpointWorld(world);
  const checkpoint = measure({
    kind: "checkpoint",
    world: saved,
    digest: createHash("sha256").update(stringify(saved)).digest("hex"),
  });
  const peers = world.seats.length - 1;
  const viewWireBytes = sum("wireBytes");
  const checkpointWireBytesPerSecond = (checkpoint.wireBytes * peers) / 10;
  const keepaliveWireBytesPerSecond = pulse.wireBytes * peers;
  const checkpointPublications = await checkpointTraffic(world);
  return {
    players: world.seats.length,
    month: world.grids[0].date.monthsElapsed,
    hostEgressFullPublication: {
      rawBytes: sum("rawBytes"),
      wireBytes: viewWireBytes,
    },
    hostCpuMsPerPublication: {
      cloneAllSeats: median(cloneTimes),
      encodeRemoteSeats: sum("encodeMs"),
    },
    remoteDecodeMsPerPublication: sum("decodeMs"),
    checkpointWireBytesPerSecond,
    keepaliveWireBytesPerSecond,
    checkpointPublications,
    // Compare successful complete-checkpoint sends with acknowledged reuse. The previous native
    // schema-1 guard rejected schema-2 worlds, so the former is a policy model, not observed traffic.
    acknowledgedPausedWireBytesPerSecond: {
      before: checkpointWireBytesPerSecond + keepaliveWireBytesPerSecond,
      after:
        checkpointPublications.acknowledgedRepeatWireBytes / 10 +
        keepaliveWireBytesPerSecond,
    },
    cadence: (["PAUSED", "SLOW", "NORMAL", "FAST", "ULTRA"] as SpeedType[]).map(
      (speed) => {
        const rate = cadence(world, speed);
        const beforeWireBytesPerSecond =
          rate.beforeHz * viewWireBytes + checkpointWireBytesPerSecond;
        const afterWireBytesPerSecond =
          rate.afterHz * viewWireBytes +
          checkpointWireBytesPerSecond +
          keepaliveWireBytesPerSecond;
        return {
          ...rate,
          beforeWireBytesPerSecond,
          afterWireBytesPerSecond,
          reductionPercent:
            100 * (1 - afterWireBytesPerSecond / beforeWireBytesPerSecond),
        };
      },
    ),
  };
}
test("measure real early and late two/four-player payloads with the shipping codec", async () => {
  loadSimData("SF");
  const samples = [];
  for (const count of [2, 4]) {
    const world = createWorld(
      COOP_TEST_SPEC,
      coopSeats(count).map((seat, i) => ({
        ...seat,
        id: `7656119800000000${i + 1}`,
      })),
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    );
    samples.push(await sample(world));
    world.seats.forEach((seat) =>
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: 1,
        command: { kind: "speed", speed: "ULTRA" },
      }),
    );
    while (world.grids[0].date.monthsElapsed < 48) stepWorld(world);
    samples.push(await sample(world));
  }
  const result = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    method:
      "Real initialized grids at months 0 and 48; shipping deflate/chunk/reassembly codec; median of three warmed runs. Cadence fields retain the prior publication-rate comparison, including complete checkpoints every ten seconds. acknowledgedPausedWireBytesPerSecond compares a successful complete-checkpoint policy with acknowledgement-based suppression: the previous native schema-1 guard rejected current schema-2 worlds, so the before rate is a policy model, not deployed traffic. Real native checkpoint/send/receive paths encode, chunk and reconstruct initial, retry and reconnect copies; disk writes are stubbed and counted, not timed. Rates exclude incoming guest heartbeats and small save acknowledgements. These are payload measurements and a cadence model, not observed Steam traffic.",
    samples,
  };
  if (!process.env.MP_NETWORK_RESULT)
    throw new Error("Run node scripts/perf/multiplayer-network.js");
  fs.writeFileSync(
    process.env.MP_NETWORK_RESULT,
    JSON.stringify(result, null, 2),
  );
}, 120000);
