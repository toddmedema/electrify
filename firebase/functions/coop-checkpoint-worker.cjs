const { parentPort, workerData } = require("node:worker_threads");
const { unpackCheckpoint } = require("./coop-checkpoint-wire.cjs");

let runtime;
try {
  runtime = require(workerData.runtimePath);
} catch {
  parentPort.postMessage({ unavailable: true });
}
if (runtime) {
  try {
    const fields = runtime.validateCheckpoint(
      unpackCheckpoint(workerData.bytes),
    );
    parentPort.postMessage({ fields });
  } catch {
    parentPort.postMessage({ invalid: true });
  }
}
