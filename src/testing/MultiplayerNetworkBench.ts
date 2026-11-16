import fs from "fs";
import { createHash } from "crypto";
import { Worker } from "worker_threads";
import path from "path";
import os from "os";
import { TextDecoder, TextEncoder } from "util";
import "../Store";
import { loadSimData } from "./SimData";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  roomView,
  stepWorld,
  hydrateWorld,
} from "../multiplayer/World";
import { COOP_TEST_SPEC, coopSeats } from "./MultiplayerFixtures";
import type { World } from "../multiplayer/Types";
import { TICK_MS } from "../Constants";
import {
  canonicalWorldBytes,
  ReplicatedWorld,
  worldDigest,
} from "../multiplayer/Replication";
import type { ReplicaBaseline, ReplicaBatch } from "../multiplayer/Replication";
import { webcrypto } from "crypto";

Object.assign(globalThis, { TextEncoder, TextDecoder });

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
async function measure(payload: unknown) {
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
    for (const frame of frames)
      decoded = (await assemble(pending, frame)) || decoded;
    const decodedMs = performance.now() - start;
    expect(createHash("sha256").update(stringify(decoded)).digest("hex")).toBe(
      createHash("sha256").update(stringify(payload)).digest("hex"),
    );
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
      for (const message of connection.checkpointQueue || []) {
        const incoming = new Map();
        let decoded: { world: World; digest: string } | undefined;
        while (message.offset * 32768 < message.bytes.length) {
          const frame = chunk(message);
          message.offset++;
          wireBytes += frame.length;
          decoded = (await assemble(incoming, frame)) || decoded;
        }
        expect(stringify(decoded!.world)).toBe(stringify(saved));
        if (acknowledge)
          await host.receive(connection.id, {
            kind: "saved",
            digest: decoded!.digest,
          });
      }
      connection.checkpointQueue = [];
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
interface ReplayMeasurement {
  replayCpuMs: number;
  processCpuMs: number;
  replayWallMs: number;
  peakHeapBytes: number;
  peakRssBytes: number;
  finalHash: string;
  measuredInWorker: true;
  localViewPublications: number;
}
interface CommandLatency {
  samples: number;
  p95Ms: number;
  scope: string;
}
function benchmarkWorker<T>(script: string, input: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve("scripts/perf", script), {
      workerData: input,
    });
    let result: T | undefined;
    worker.once("message", (value) => {
      result = value;
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0 || !result)
        reject(new Error(`${script} worker exited ${code} without a result`));
      else resolve(result);
    });
  });
}
/** One second of actual ticks, batched on the worker's 100 ms flush cadence. No timers are slept.
 * Replay CPU is measured in a separate isolate; wire rates are a virtual-time model. */
async function replicationSample(
  world: World,
  checkpointBytes: number,
  pulseBytes: number,
) {
  const peers = world.seats.length - 1;
  const speeds = [];
  for (const speed of ["SLOW", "FAST", "ULTRA"] as const) {
    let now = 0;
    const host = new ReplicatedWorld(
      hydrateWorld(checkpointWorld(world)),
      () => now,
    );
    for (const seat of host.world.seats)
      host.command(seat.id, {
        matchId: host.world.matchId,
        epoch: host.world.epoch,
        sequence: (host.world.sequences[seat.id] || 0) + 1,
        command: { kind: "speed", speed },
      });
    host.drain();
    const baseline: ReplicaBaseline = host.baseline();
    const bootstrap: ReplicaBatch = host.drain()!;
    const batches: ReplicaBatch[] = [];
    const batchTimes: number[] = [];
    let nextTick = TICK_MS[speed];
    for (now = 100; now <= 1000; now += 100) {
      while (nextTick <= now + 1e-8) {
        expect(host.step()).toBe(true);
        nextTick += TICK_MS[speed];
      }
      if (now === 1000) host.verify();
      const batch = host.drain();
      if (batch) {
        batches.push(batch);
        batchTimes.push(now);
      }
    }
    const baselinePayload = { kind: "baseline", ...baseline };
    const baselineMeasurement = await measure(baselinePayload);
    const recordMeasurements: Awaited<ReturnType<typeof measure>>[] = [];
    for (const batch of batches)
      recordMeasurements.push(
        await measure({
          kind: "records",
          matchId: world.matchId,
          epoch: world.epoch,
          ...batch,
        }),
      );
    const sum = (key: "wireBytes" | "encodeMs") =>
      recordMeasurements.reduce((n, value) => n + value[key], 0);
    const replay = await benchmarkWorker<ReplayMeasurement>(
      "multiplayer-replay.js",
      {
        baseline: stringify(baseline),
        bootstrap: stringify(bootstrap),
        batches: stringify(batches),
        batchTimes,
      },
    );
    const hash = await worldDigest(canonicalWorldBytes(host.world), (bytes) =>
      webcrypto.subtle.digest("SHA-256", bytes),
    );
    expect(replay.finalHash).toBe(hash);
    expect(replay.localViewPublications).toBe(5);
    const recordsPerGuest = sum("wireBytes");
    const checkpointPerGuest = checkpointBytes / 10;
    const totalPerGuest = recordsPerGuest + checkpointPerGuest + pulseBytes;
    speeds.push({
      speed,
      multiplier: speed === "SLOW" ? 1 : speed === "FAST" ? 12 : 24,
      virtualDurationMs: 1000,
      ticks: batches
        .flatMap((batch) => batch.records)
        .reduce((n, record) => n + (record.t === "step" ? record.n : 0), 0),
      recordBatches: batches.length,
      startupBaselineWireBytesPerGuest: baselineMeasurement.wireBytes,
      startupVerificationWireBytesPerGuest: (
        await measure({
          kind: "records",
          matchId: world.matchId,
          epoch: world.epoch,
          ...bootstrap,
        })
      ).wireBytes,
      steadyWireBytesPerSecondPerGuest: {
        records: recordsPerGuest,
        baseline: 0,
        durableCheckpoint: checkpointPerGuest,
        keepalive: pulseBytes,
        total: totalPerGuest,
      },
      steadyHostWireBytesPerSecond: totalPerGuest * peers,
      recordEncodeMsPerSecondAllGuests: sum("encodeMs") * peers,
      guest: {
        ...replay,
        replayCorePercent: replay.processCpuMs / 10,
        replayThreadCorePercent: replay.replayCpuMs / 10,
        memoryScope:
          "Heap belongs to the Node replay worker and includes its TypeScript loader, decoded baseline and setup; peak RSS is the whole-process lifetime high-water mark, including earlier fixture workers. These are diagnostic upper bounds, not browser-worker memory. Baseline install is excluded from replay CPU.",
      },
    });
  }
  return {
    speeds,
    commandLatency: await benchmarkWorker<CommandLatency>(
      "multiplayer-latency.js",
      { world: stringify(checkpointWorld(world)) },
    ),
  };
}
async function sample(world: World) {
  const localProjectionTimes: number[] = [];
  for (let run = 0; run < 4; run++) {
    const start = performance.now();
    roomView(world, world.seats[0].id);
    if (run > 0) localProjectionTimes.push(performance.now() - start);
  }
  const pulse = await measure({
    kind: "keepalive",
    matchId: world.matchId,
    epoch: world.epoch,
    revision: world.revision,
  });
  const saved = checkpointWorld(world);
  const checkpoint = await measure({
    kind: "checkpoint",
    world: saved,
    digest: createHash("sha256").update(stringify(saved)).digest("hex"),
  });
  const peers = world.seats.length - 1;
  const checkpointWireBytesPerSecond = (checkpoint.wireBytes * peers) / 10;
  const keepaliveWireBytesPerSecond = pulse.wireBytes * peers;
  const checkpointPublications = await checkpointTraffic(world);
  return {
    players: world.seats.length,
    month: world.grids[0].date.monthsElapsed,
    hostLocalProjectionCpuMsPerPublication: median(localProjectionTimes),
    checkpoint,
    checkpointWireBytesPerSecond,
    keepaliveWireBytesPerSecond,
    checkpointPublications,
    replication: await replicationSample(
      world,
      checkpoint.wireBytes,
      pulse.wireBytes,
    ),
    acknowledgedPausedHostWireBytesPerSecond:
      checkpointPublications.acknowledgedRepeatWireBytes / 10 +
      keepaliveWireBytesPerSecond,
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
    cpu: os.cpus()[0].model,
    method:
      "Real initialized grids at months 0 and 48; shipping deflate/chunk/reassembly codec; median of three warmed runs. Hosts project only their local seat. Real native checkpoint/send/receive paths encode, chunk and reconstruct initial, retry and reconnect copies; disk writes are stubbed and counted, not timed. Rates exclude incoming guest heartbeats and small save acknowledgements. Real one-second record traces use shipping codec bytes, worker-thread replay CPU/heap samples, and actual ReplicaRuntime/ViewPublication commands over an in-process shipping-codec mock transport. The absolute command p95 excludes IPC, continuously running simulation/video load and network transit. Steady rates exclude initial/recovery baselines (reported separately); complete durable checkpoints are included every ten seconds. These are payload measurements and a virtual-time traffic model, not observed Steam traffic.",
    samples,
  };
  if (!process.env.MP_NETWORK_RESULT)
    throw new Error("Run node scripts/perf/multiplayer-network.js");
  fs.writeFileSync(
    process.env.MP_NETWORK_RESULT,
    JSON.stringify(result, null, 2),
  );
}, 180000);
