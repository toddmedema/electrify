import { getScenario } from "../data/Scenarios";
import { browserCheckpoints } from "./BrowserCheckpoints";
import type { CrossplayApi } from "./CrossplayApi";
import type {
  CheckpointStore,
  SharedSaveLibrary,
  WireMessage,
} from "./SessionTransport";
import type { World } from "./Types";
import { decodeWire, encodeWire } from "./WireJson";

const MAX_COMPRESSED_BYTES = 6 * 1024 * 1024;
const MAX_DECODED_BYTES = 32 * 1024 * 1024;
const ONLINE_AUTOSAVE_MS = 30_000;
const TRANSFER_KINDS = new Set(["baseline", "scenario"]);

interface TransferPeer {
  roomId: string;
  to: string;
  epoch: string;
  generation: string;
}

interface EncodedSnapshot {
  content: string;
  digest: string;
}

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Multiplayer data is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function encodeSnapshot(snapshot: unknown): Promise<EncodedSnapshot> {
  const json = new TextEncoder().encode(encodeWire(snapshot));
  if (json.length > MAX_DECODED_BYTES)
    throw new Error("Multiplayer data is too large.");
  const compressed = await readBounded(
    new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")),
    MAX_COMPRESSED_BYTES,
  );
  let content = "";
  for (let offset = 0; offset < compressed.length; offset += 0x6000)
    content += btoa(
      String.fromCharCode(...compressed.subarray(offset, offset + 0x6000)),
    );
  return { content, digest: await digest(compressed) };
}

async function decodeSnapshot({ content, digest: expected }: EncodedSnapshot) {
  if (
    typeof content !== "string" ||
    content.length > (MAX_COMPRESSED_BYTES / 3) * 4 ||
    !/^[a-f0-9]{64}$/.test(expected)
  )
    throw new Error("Invalid multiplayer data.");
  const bytes = Uint8Array.from(atob(content), (character) =>
    character.charCodeAt(0),
  );
  if ((await digest(bytes)) !== expected)
    throw new Error("Multiplayer data failed its integrity check.");
  const json = await readBounded(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    MAX_DECODED_BYTES,
  );
  return decodeWire(new TextDecoder("utf-8", { fatal: true }).decode(json));
}

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
      ...(await encodeSnapshot(payload)),
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
  const payload = (await decodeSnapshot(result)) as WireMessage;
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
    async remove(id) {
      await api.request("room/withdraw", { roomId: id });
      return list(true);
    },
    async write(world, source, explicit = false) {
      const { roomId, seatId } = scope();
      if (!roomId || !seatId)
        throw new Error("Multiplayer room is no longer active.");
      try {
        await browserCheckpoints(seatId).write(world, source);
        saved(Date.now());
      } catch {
        // Durable saves still work with an unavailable or full local store.
      }
      if (
        !explicit &&
        published?.roomId === roomId &&
        published.epoch === world.epoch &&
        (published.revision === world.revision ||
          Date.now() - published.at < ONLINE_AUTOSAVE_MS)
      )
        return;
      const name = getScenario(
        world.spec.scenarioId,
        world.spec.customScenario,
      )?.name;
      const { savedAt } = await api.request<{ savedAt: number }>(
        "save/publish",
        {
          roomId,
          ...(await encodeSnapshot(world)),
          explicit,
          name,
        },
      );
      published = {
        roomId,
        epoch: world.epoch,
        revision: world.revision,
        at: savedAt,
      };
    },
  };
}
