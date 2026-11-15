// Replay the actual guest runtime, including local view projection, in its own V8 isolate.
const { parentPort, workerData } = require("node:worker_threads");
require("../testing/replication-runtime")();
const { ReplicaRuntime } = require("../../src/multiplayer/ReplicaRuntime");
const { loadSimData } = require("../../src/testing/SimData");
const { parse } = require("../../electron/coop-codec.cjs");
const baseline = parse(workerData.baseline);
const bootstrap = parse(workerData.bootstrap);
const batches = parse(workerData.batches);
loadSimData(baseline.world.grids[0].location.id);
const median = (values) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
(async () => {
  const cpuSamples = [],
    processCpuSamples = [],
    wallSamples = [];
  let peakHeapBytes = 0,
    finalHash,
    localViewPublications;
  for (let run = 0; run < 4; run++) {
    let now = 0,
      views = 0,
      verified,
      waiter;
    const runtime = new ReplicaRuntime(
      (event) => {
        peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
        if (event.kind === "views") {
          views++;
          void runtime.receive({ kind: "views-applied" });
        } else if (event.kind === "progress" && event.verified) {
          verified = event.verified;
          if (waiter && verified.index === waiter.index) {
            clearTimeout(waiter.timeout);
            waiter.resolve(verified.hash);
            waiter = undefined;
          }
        } else if (event.kind === "resync" && waiter) {
          clearTimeout(waiter.timeout);
          waiter.reject(new Error(event.reason));
          waiter = undefined;
        }
      },
      async () => {},
      () => now,
    );
    function waitForHash(index) {
      if (verified?.index === index) return Promise.resolve(verified.hash);
      return new Promise((resolve, reject) => {
        waiter = {
          index,
          resolve,
          reject,
          timeout: setTimeout(
            () => reject(new Error("Replica benchmark hash timed out")),
            5000,
          ),
        };
      });
    }
    await runtime.receive({
      kind: "baseline",
      baseline,
      seat: baseline.world.seats[1].id,
    });
    await runtime.receive({
      kind: "records",
      matchId: baseline.matchId,
      epoch: baseline.epoch,
      ...bootstrap,
    });
    await waitForHash(bootstrap.from + bootstrap.records.length - 1);
    const initialViews = views;
    const cpu = process.threadCpuUsage();
    const allCpu = process.cpuUsage();
    const started = performance.now();
    for (let i = 0; i < batches.length; i++) {
      now = workerData.batchTimes[i];
      await runtime.receive({
        kind: "records",
        matchId: baseline.matchId,
        epoch: baseline.epoch,
        ...batches[i],
      });
    }
    const last = batches[batches.length - 1];
    finalHash = await waitForHash(last.from + last.records.length - 1);
    localViewPublications = views - initialViews;
    const elapsed = process.threadCpuUsage(cpu);
    const allElapsed = process.cpuUsage(allCpu);
    if (run > 0) {
      cpuSamples.push((elapsed.user + elapsed.system) / 1000);
      processCpuSamples.push((allElapsed.user + allElapsed.system) / 1000);
      wallSamples.push(performance.now() - started);
    }
  }
  parentPort.postMessage({
    measuredInWorker: true,
    samples: cpuSamples.length,
    replayCpuMs: median(cpuSamples),
    processCpuMs: median(processCpuSamples),
    replayWallMs: median(wallSamples),
    cpuScope:
      "Actual ReplicaRuntime replay, local-seat view publication and canonical capture. replayCpuMs counts its thread; processCpuMs also counts SHA-256 and any otherwise-idle parent/GC work.",
    localViewPublications,
    peakHeapBytes,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    finalHash,
  });
})().catch((error) => {
  throw error;
});
