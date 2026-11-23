import { decodeWire, encodeWire } from "./WireJson";

const MAX_COMPRESSED_BYTES = 6 * 1024 * 1024;
const MAX_DECODED_BYTES = 32 * 1024 * 1024;

export interface EncodedSnapshot {
  content: string;
  digest: string;
}

export type SnapshotJob =
  | { kind: "encode"; value: unknown }
  | { kind: "decode"; value: EncodedSnapshot };

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

export async function encodeSnapshot(
  snapshot: unknown,
): Promise<EncodedSnapshot> {
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

export async function decodeSnapshot({
  content,
  digest: expected,
}: EncodedSnapshot) {
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
