import { downloadJson } from "../SaveFile";
import { getScenario } from "../data/Scenarios";
import { browserCheckpoints } from "./BrowserCheckpoints";
import type { CrossplayApi } from "./CrossplayApi";
import type {
  CheckpointStore,
  SharedSaveLibrary,
  WireMessage,
} from "./SessionTransport";
import type { World } from "./Types";
import { encodeWire } from "./WireJson";
import type { EncodedSnapshot, SnapshotJob } from "./SnapshotCodec";

const ONLINE_AUTOSAVE_MS = 30_000;
const TRANSFER_KINDS = new Set(["baseline", "scenario"]);

interface TransferPeer {
  roomId: string;
  to: string;
  epoch: string;
  generation: string;
}

let queuedSnapshots = 0;
let snapshotQueue: Promise<unknown> = Promise.resolve();

async function runSnapshot(job: SnapshotJob, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { createSnapshotWorker } = await import("./WorkerClient");
  signal?.throwIfAborted();
  const worker = createSnapshotWorker();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<unknown>((resolve, reject) => {
      abort = () => reject(new Error("Multiplayer transfer cancelled."));
      signal?.addEventListener("abort", abort, { once: true });
      deadline = setTimeout(
        () => reject(new Error("Multiplayer transfer took too long.")),
        5_000,
      );
      worker.onmessage = ({ data }) => {
        if (data.ok) resolve(data.value);
        else reject(new Error("Invalid multiplayer transfer."));
      };
      worker.onerror = () =>
        reject(new Error("Multiplayer transfer worker stopped."));
      worker.postMessage(job);
    });
  } finally {
    clearTimeout(deadline);
    if (abort) signal?.removeEventListener("abort", abort);
    worker.terminate();
  }
}

function queueSnapshot(job: SnapshotJob, signal?: AbortSignal) {
  if (queuedSnapshots >= 8)
    throw new Error("Multiplayer transfer capacity was reached.");
  queuedSnapshots++;
  const scheduled = snapshotQueue
    .then(() => runSnapshot(job, signal))
    .finally(() => queuedSnapshots--);
  snapshotQueue = scheduled.catch(() => undefined);
  return scheduled;
}

const encodeSnapshot = (value: unknown, signal?: AbortSignal) =>
  queueSnapshot({ kind: "encode", value }, signal) as Promise<EncodedSnapshot>;

const decodeSnapshot = (value: EncodedSnapshot, signal?: AbortSignal) =>
  queueSnapshot({ kind: "decode", value }, signal);

export async function storeTransfer(
  api: CrossplayApi,
  peer: TransferPeer,
  payload: WireMessage,
  signal: AbortSignal,
) {
  if (!TRANSFER_KINDS.has(payload.kind))
    throw new Error("Unsupported multiplayer transfer.");
  const { reference } = await api.request<{ reference: string }>(
    "transfer/put",
    {
      ...peer,
      ...(await encodeSnapshot(payload, signal)),
    },
    { signal },
  );
  return reference;
}

export async function readTransfer(
  api: CrossplayApi,
  peer: TransferPeer,
  reference: string,
  signal: AbortSignal,
) {
  const result = await api.request<EncodedSnapshot>(
    "transfer/get",
    {
      ...peer,
      reference,
    },
    { signal },
  );
  const payload = (await decodeSnapshot(result, signal)) as WireMessage;
  if (!payload || !TRANSFER_KINDS.has(payload.kind))
    throw new Error("Invalid multiplayer transfer.");
  return payload;
}

export function onlineCheckpoints(
  api: CrossplayApi,
  scope: () => { roomId?: string; seatId?: string },
  saved: (timestamp: number) => void,
): CheckpointStore {
  let published:
    { roomId: string; epoch: string; revision: number; at: number } | undefined;
  const list = async (sync: boolean): Promise<SharedSaveLibrary> => {
    if (!sync) return { slots: [], cloudState: "ready" };
    const { slots } = await api.request<Pick<SharedSaveLibrary, "slots">>(
      "room/list",
      {},
      { userAction: true },
    );
    return { slots, cloudState: "ready" };
  };
  return {
    async list(sync) {
      return list(sync);
    },
    async read(id) {
      const roomId = id ?? scope().roomId;
      if (!roomId) return null;
      const result = await api.request<EncodedSnapshot>("save/read", {
        roomId,
      });
      return (await decodeSnapshot(result)) as World;
    },
    async export(id) {
      const { roomId, seatId } = scope();
      const target = id ?? roomId;
      if (!target)
        throw new Error("There is no multiplayer campaign to export.");
      const local =
        !id && seatId
          ? await browserCheckpoints(seatId)
              .read()
              .catch(() => null)
          : null;
      const world =
        local ??
        (await decodeSnapshot(
          await api.request<EncodedSnapshot>("save/download", {
            roomId: target,
          }),
        ));
      downloadJson("electrify-multiplayer-campaign.json", {
        format: "electrify-multiplayer",
        world: JSON.parse(encodeWire(world)),
      });
    },
    async remove(id) {
      await api.request("room/withdraw", { roomId: id });
      return list(true);
    },
    async write(world, source, explicit = false) {
      const { roomId, seatId } = scope();
      if (!roomId || !seatId)
        throw new Error("Multiplayer room is no longer active.");
      try {
        const cache = browserCheckpoints(seatId);
        const local = source && (await cache.read(world.matchId));
        const superseded =
          source &&
          local &&
          local.epoch === source.epoch &&
          local.revision >= source.revision
            ? {
                matchId: local.matchId,
                epoch: local.epoch,
                revision: local.revision,
              }
            : source;
        await cache.write(world, superseded);
        saved(Date.now());
      } catch {
        // Durable saves still work with an unavailable or full local store.
      }
      if (
        !explicit &&
        published?.roomId === roomId &&
        published.epoch === world.epoch &&
        (published.revision === world.revision ||
          performance.now() - published.at < ONLINE_AUTOSAVE_MS)
      )
        return;
      const name = getScenario(
        world.spec.scenarioId,
        world.spec.customScenario,
      )?.name;
      await api.request("save/publish", {
        roomId,
        ...(await encodeSnapshot(world)),
        explicit,
        ...(name && { name: name.slice(0, 72) }),
      });
      published = {
        roomId,
        epoch: world.epoch,
        revision: world.revision,
        at: performance.now(),
      };
    },
  };
}
