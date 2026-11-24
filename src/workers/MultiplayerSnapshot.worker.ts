import {
  decodeSnapshot,
  encodeSnapshot,
  type SnapshotJob,
} from "../multiplayer/SnapshotCodec";

const worker = globalThis as unknown as Worker;
worker.onmessage = ({ data }: MessageEvent<SnapshotJob>) => {
  const job =
    data.kind === "decode"
      ? decodeSnapshot(data.value)
      : encodeSnapshot(data.value);
  void job.then(
    (value) => worker.postMessage({ ok: true, value }),
    () => worker.postMessage({ ok: false }),
  );
};
