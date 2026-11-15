// Real command/replay/publication paths over the shipping codec, with zero network transit time.
// This is an in-process mock transport; it excludes IPC, video load and a continuously ticking clock.
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
const { parentPort, workerData } = require("node:worker_threads");
require("../testing/replication-runtime")();
const { ReplicatedWorld } = require("../../src/multiplayer/Replication");
const { ReplicaRuntime } = require("../../src/multiplayer/ReplicaRuntime");
const { ViewPublication } = require("../../src/multiplayer/ViewPublication");
const { hydrateWorld } = require("../../src/multiplayer/World");
const { loadSimData } = require("../../src/testing/SimData");
const {
  parse,
  encode,
  encodeAsync,
  chunk,
  assemble,
} = require("../../electron/steam-multiplayer.cjs");
const world = parse(workerData.world);
loadSimData(world.grids[0].location.id);
const seat = world.seats[1].id;
const percentile95 = (values) =>
  values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
async function wire(payload) {
  const message = ["view", "baseline"].includes(payload.kind)
    ? await encodeAsync(payload)
    : encode(payload);
  const incoming = new Map();
  let decoded;
  while (message.offset * 32768 < message.bytes.length) {
    decoded = (await assemble(incoming, chunk(message))) || decoded;
    message.offset++;
  }
  return decoded;
}
function command(host, trial) {
  const envelope = {
    matchId: host.world.matchId,
    epoch: host.world.epoch,
    sequence: (host.world.sequences[seat] || 0) + 1,
    command: { kind: "rate", value: 0.1 + trial * 0.0001 },
  };
  assert.equal(host.command(seat, envelope).error, undefined);
  return envelope.sequence;
}
async function snapshotLatency() {
  const host = new ReplicatedWorld(hydrateWorld(world));
  const publication = new ViewPublication();
  publication.request(host.world, performance.now(), { force: true });
  publication.take(host.world, performance.now(), [seat]);
  const samples = [];
  for (let trial = 0; trial < 24; trial++) {
    await delay((trial % 5) * 20);
    const started = performance.now();
    const sequence = command(host, trial);
    const wait = publication.request(host.world, started, {
      urgent: true,
      receipt: { sender: seat, sequence },
    });
    if (wait) await delay(Math.ceil(wait));
    const view = publication.take(host.world, performance.now(), [seat])[seat];
    const received = await wire({ kind: "view", view });
    assert.equal(received.view.lastSequence, sequence);
    if (trial >= 4) samples.push(performance.now() - started);
    host.drain();
  }
  return percentile95(samples);
}
async function replicaLatency() {
  const host = new ReplicatedWorld(hydrateWorld(world));
  let pending;
  const runtime = new ReplicaRuntime(
    (event) => {
      if (event.kind === "views") {
        const view = event.views[seat];
        void runtime.receive({ kind: "views-applied" });
        if (pending && view?.lastSequence >= pending.sequence) {
          clearTimeout(pending.timeout);
          pending.resolve(performance.now() - pending.started);
          pending = undefined;
        }
      } else if (event.kind === "resync" && pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(event.reason));
        pending = undefined;
      }
    },
    async () => {},
  );
  const baseline = await wire({ kind: "baseline", ...host.baseline() });
  await runtime.receive({ kind: "baseline", baseline, seat });
  const bootstrap = host.drain();
  await runtime.receive(
    await wire({
      kind: "records",
      matchId: host.world.matchId,
      epoch: host.world.epoch,
      ...bootstrap,
    }),
  );
  const samples = [];
  for (let trial = 0; trial < 24; trial++) {
    await delay((trial % 5) * 20);
    const started = performance.now();
    const sequence = command(host, trial);
    const view = new Promise((resolve, reject) => {
      pending = {
        resolve,
        reject,
        started,
        sequence,
        timeout: setTimeout(
          () => reject(new Error("Mock replica view timed out")),
          5000,
        ),
      };
    });
    // The host coalesces non-step records within the current macrotask.
    await delay(0);
    await runtime.receive(
      await wire({
        kind: "records",
        matchId: host.world.matchId,
        epoch: host.world.epoch,
        ...host.drain(),
      }),
    );
    const elapsed = await view;
    if (trial >= 4) samples.push(elapsed);
  }
  return percentile95(samples);
}
(async () => {
  const snapshotP95Ms = await snapshotLatency();
  const replicaP95Ms = await replicaLatency();
  parentPort.postMessage({
    samplesPerMode: 20,
    snapshotP95Ms,
    replicaP95Ms,
    addedP95Ms: replicaP95Ms - snapshotP95Ms,
    within50Ms: replicaP95Ms <= snapshotP95Ms + 50,
    scope:
      "Zero-transit in-process mock with shipping async view/baseline compression, record decoding, real ReplicaRuntime and ViewPublication. Paused command stream; IPC, sustained clock/video load and Steam are excluded.",
  });
})().catch((error) => {
  throw error;
});
