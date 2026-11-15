#!/usr/bin/env node
// Capture canonical bytes and SHA-256 inside a worker, excluding fixture setup and message cloning.
const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const os = require("node:os");
if (isMainThread) {
  require("../run-compatibility");
  const worker = new Worker(__filename);
  worker.once("message", (measurement) =>
    console.log(JSON.stringify(measurement, null, 2)),
  );
  worker.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  worker.once("exit", (code) => {
    if (code) process.exitCode = code;
  });
} else {
  require("../testing/replication-runtime")();
  const {
    canonicalWorldBytes,
    worldDigest,
  } = require("../../src/multiplayer/Replication");
  const {
    createReplicationFixture,
    prepareReplicationFixture,
    advanceReplicationFixture,
  } = require("../../src/testing/ReplicationFixtures");
  const host = createReplicationFixture("custom", 4);
  prepareReplicationFixture(host);
  advanceReplicationFixture(host, 48);
  (async () => {
    const captures = [],
      digests = [];
    let canonicalBytes = 0,
      hash;
    for (let run = 0; run < 6; run++) {
      let started = performance.now();
      const bytes = canonicalWorldBytes(host.world);
      const captureMs = performance.now() - started;
      started = performance.now();
      hash = await worldDigest(bytes);
      const digestMs = performance.now() - started;
      canonicalBytes = bytes.byteLength;
      if (run > 0) {
        captures.push(captureMs);
        digests.push(digestMs);
      }
    }
    const median = (values) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    parentPort.postMessage({
      platform: process.platform,
      arch: process.arch,
      node: process.versions.node,
      cpu: os.cpus()[0].model,
      players: 4,
      month: 48,
      measuredInWorker: true,
      samples: captures.length,
      canonicalBytes,
      canonicalMedianMs: median(captures),
      digestMedianMs: median(digests),
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      hash,
    });
  })().catch((error) => {
    throw error;
  });
}
