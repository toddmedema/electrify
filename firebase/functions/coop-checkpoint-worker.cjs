const { parentPort, workerData } = require("node:worker_threads");
const { unpackCheckpoint } = require("./coop-checkpoint-wire.cjs");

function transferFields(value, epoch) {
  if (!value || typeof value !== "object") return;
  if (
    value.kind === "baseline" &&
    value.epoch === epoch &&
    value.world?.epoch === epoch &&
    value.matchId === value.world.matchId &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0
  )
    return { kind: value.kind };
  if (
    value.kind === "scenario" &&
    typeof value.selectionKey === "string" &&
    value.selectionKey.length <= 256 &&
    value.scenario?.id === 999
  )
    return { kind: value.kind };
}

function validate() {
  let runtime;
  if (workerData.runtimePath) {
    try {
      runtime = require(workerData.runtimePath);
    } catch {
      return { unavailable: true };
    }
  }
  try {
    const snapshot = unpackCheckpoint(workerData.bytes);
    const fields = runtime
      ? runtime.validateCheckpoint(snapshot)
      : transferFields(JSON.parse(snapshot), workerData.epoch);
    return { fields };
  } catch {
    return { invalid: true };
  }
}

parentPort.postMessage(validate());
