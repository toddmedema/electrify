// Run one guest's real whole-world replay in its own V8 isolate, outside the Jest VM.
const { parentPort, workerData } = require("node:worker_threads");
require("../testing/replication-runtime")();
const {
  Replica,
  canonicalWorldBytes,
  worldDigest,
} = require("../../src/multiplayer/Replication");
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
    finalHash;
  for (let run = 0; run < 4; run++) {
    const replica = new Replica();
    replica.install(baseline);
    replica.apply(bootstrap.from, bootstrap.records);
    const cpu = process.threadCpuUsage();
    const allCpu = process.cpuUsage();
    const started = performance.now();
    for (const batch of batches) {
      for (let i = 0; i < batch.records.length; i++) {
        const record = batch.records[i];
        replica.apply(batch.from + i, [record]);
        if (record.t === "verify") {
          // Capture at the record boundary, before later records can mutate the live world.
          const bytes = canonicalWorldBytes(replica.world);
          peakHeapBytes = Math.max(
            peakHeapBytes,
            process.memoryUsage().heapUsed,
          );
          finalHash = await worldDigest(bytes);
        }
      }
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    }
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
      "replayCpuMs measures the replay thread and canonical capture; processCpuMs includes all process threads (SHA-256 and any otherwise-idle parent/GC work).",
    peakHeapBytes,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    finalHash,
  });
})().catch((error) => {
  throw error;
});
