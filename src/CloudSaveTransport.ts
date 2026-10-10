import {
  collection,
  doc,
  getDocsFromServer,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { firebaseAppAuth, getDb } from "./Globals";
import {
  downloadSaveRecovery,
  encodeSaveFile,
  MAX_SAVE_FILE_BYTES,
} from "./SaveFile";
import { parseSave } from "./SaveGame";
import { validateSaveFileEnvelope } from "./SaveModel";
import { newSaveId } from "./SaveRepository";
import type { SaveFileType, SaveId, SaveMetadata, SaveRecord } from "./Types";

export const SHARE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9]{10}$/;
const CHUNK_CHARACTERS = 150_000;
export class CloudConflict extends Error {}

export interface IncompatibleCloudSave {
  id: SaveId;
  version: string;
  name: string;
}

export interface CloudSaveHead {
  id: string;
  version: string;
  deleted: boolean;
  chunks: string[];
  metadata?: SaveMetadata;
  garbage?: string[];
  invalid?: boolean;
  writerDeviceId?: string;
  writerLocalId?: string;
  sourceRevision?: number;
  uploadedAt?: number;
  uploadedMinute?: number;
}
export interface CloudSaveTransport {
  list(uid: string): Promise<CloudSaveHead[]>;
  read(head: CloudSaveHead): Promise<SaveRecord>;
  write(
    uid: string,
    id: string,
    expected: string | undefined,
    record: SaveRecord | null,
  ): Promise<string>;
}

/** Cryptographic, unbiased base62; this identity never affects simulation randomness. */
export function newShareId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  while (id.length < 10) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte < 248 && id.length < 10) id += alphabet[byte % 62];
    }
  }
  return id;
}

export function saveChunks(file: SaveFileType): string[] {
  const json = JSON.stringify(encodeSaveFile(file));
  if (new TextEncoder().encode(json).length > MAX_SAVE_FILE_BYTES)
    throw new Error(
      "This save is too large for cloud backup. Your device copy is still available.",
    );
  const chunks: string[] = [];
  for (let offset = 0; offset < json.length;) {
    let end = Math.min(offset + CHUNK_CHARACTERS, json.length);
    // Do not split a UTF-16 surrogate pair across Firestore strings.
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    chunks.push(json.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function parseHead(id: string, raw: Record<string, unknown>): CloudSaveHead {
  const metadata = raw.metadata as
    | (SaveMetadata & { uploadedAt?: unknown; uploadedMinute?: unknown })
    | undefined;
  if (
    typeof raw.version !== "string" ||
    !/^[a-f0-9]{32}$/.test(raw.version) ||
    typeof raw.deleted !== "boolean" ||
    !Array.isArray(raw.chunks) ||
    raw.chunks.length > 60 ||
    raw.chunks.some(
      (id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id),
    )
  )
    throw new Error(
      "A cloud save is invalid. Your device saves are still available.",
    );
  if (
    raw.garbage !== undefined &&
    (!Array.isArray(raw.garbage) ||
      raw.garbage.some(
        (id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id),
      ))
  )
    throw new Error("A cloud cleanup record is invalid.");
  return {
    id,
    version: raw.version,
    deleted: raw.deleted,
    chunks: raw.chunks as string[],
    metadata,
    garbage: (raw.garbage || []) as string[],
    writerDeviceId:
      typeof raw.writerDeviceId === "string" ? raw.writerDeviceId : undefined,
    writerLocalId:
      typeof raw.writerLocalId === "string" ? raw.writerLocalId : undefined,
    sourceRevision:
      typeof raw.sourceRevision === "number" &&
      Number.isSafeInteger(raw.sourceRevision) &&
      raw.sourceRevision > 0
        ? raw.sourceRevision
        : undefined,
    uploadedAt:
      typeof metadata?.uploadedAt === "number" &&
      Number.isFinite(metadata.uploadedAt)
        ? metadata.uploadedAt
        : undefined,
    uploadedMinute:
      typeof metadata?.uploadedMinute === "number" &&
      Number.isFinite(metadata.uploadedMinute)
        ? metadata.uploadedMinute
        : undefined,
  };
}

async function readRawFile(chunks: string[]): Promise<unknown> {
  const snapshots = await Promise.all(
    chunks.map((id) => getDocFromServer(doc(getDb(), "saveBlobs", id))),
  );
  let json = "";
  for (const snapshot of snapshots) {
    const data = snapshot.data()?.data;
    if (typeof data !== "string" || data.length > CHUNK_CHARACTERS)
      throw new Error("This cloud save is incomplete.");
    json += data;
  }
  if (new TextEncoder().encode(json).length > MAX_SAVE_FILE_BYTES)
    throw new Error("This cloud save is too large.");
  return JSON.parse(json);
}

async function readFile(chunks: string[]): Promise<SaveFileType> {
  return validateSaveFileEnvelope(await readRawFile(chunks), parseSave);
}

/** Preserve the original payload without importing it or changing the cloud backup. */
export async function downloadCloudSaveRecovery(
  uid: string,
  issue: IncompatibleCloudSave,
): Promise<void> {
  if (firebaseAppAuth.currentUser?.uid !== uid)
    throw new Error("Sign in to the account that owns this backup.");
  const snapshot = await getDocFromServer(
    doc(getDb(), "users", uid, "cloudSaves", issue.id),
  );
  const data = snapshot.data();
  if (!data) throw new Error("This cloud backup is no longer available.");
  const head = parseHead(issue.id, data);
  if (head.deleted || head.version !== issue.version)
    throw new Error(
      "This backup changed. Refresh your saved games and try again.",
    );
  const raw = await readRawFile(head.chunks);
  if (firebaseAppAuth.currentUser?.uid !== uid)
    throw new Error("Sign in to the account that owns this backup.");
  downloadSaveRecovery(issue.id, raw);
}

export class FirebaseSaveTransport implements CloudSaveTransport {
  async list(uid: string): Promise<CloudSaveHead[]> {
    const result = await getDocsFromServer(
      collection(getDb(), "users", uid, "cloudSaves"),
    );
    const heads = result.docs.map((snapshot) => {
      try {
        return parseHead(snapshot.id, snapshot.data());
      } catch {
        return {
          id: snapshot.id,
          version: "",
          deleted: false,
          chunks: [],
          invalid: true,
        } as CloudSaveHead;
      }
    });
    for (const head of heads) {
      if (head.garbage?.length)
        await this.cleanup(uid, head.id, head.version, head.garbage).catch(
          () => undefined,
        );
    }
    return heads;
  }
  async read(head: CloudSaveHead): Promise<SaveRecord> {
    const file = await readFile(head.chunks);
    const metadata = head.metadata;
    if (
      !metadata ||
      metadata.id !== head.id ||
      typeof metadata.scenarioName !== "string" ||
      ![
        metadata.createdAt,
        metadata.savedAt,
        metadata.lastPlayedAt || metadata.createdAt,
      ].every(
        (date) => typeof date === "string" && Number.isFinite(Date.parse(date)),
      )
    )
      throw new Error("This cloud save's details are invalid.");
    return {
      save: file.save,
      result: file.result,
      metadata: {
        id: head.id,
        name: file.name,
        status: file.status,
        revision: 1,
        createdAt: metadata.createdAt,
        lastPlayedAt: metadata.lastPlayedAt,
        savedAt: file.save.savedAt,
        scenarioId: file.save.game.scenarioId,
        scenarioName: metadata.scenarioName,
        locationName: file.save.game.location.name,
        difficulty: file.save.game.difficulty,
        date: {
          month: file.save.game.date.month,
          year: file.save.game.date.year,
        },
      },
    };
  }
  async write(
    uid: string,
    id: string,
    expected: string | undefined,
    record: SaveRecord | null,
  ): Promise<string> {
    const ref = doc(getDb(), "users", uid, "cloudSaves", id);
    const chunks = record
      ? saveChunks({
          name: record.metadata.name,
          status: record.metadata.status,
          save: record.save,
          result: record.result,
        })
      : [];
    const ids = chunks.map(() => newSaveId());
    const version = newSaveId();
    const garbage = await runTransaction(getDb(), async (transaction) => {
      const previous = await transaction.get(ref);
      if (previous.data()?.version !== expected)
        throw new CloudConflict("This save changed on another device.");
      const garbage: string[] = [
        ...(previous.data()?.garbage || []),
        ...(previous.data()?.chunks || []),
      ];
      chunks.forEach((data, index) =>
        transaction.set(doc(getDb(), "saveBlobs", ids[index]), {
          uid,
          shareId: null,
          data,
          expiresAt: null,
        }),
      );
      transaction.set(
        ref,
        JSON.parse(
          JSON.stringify({
            version,
            deleted: !record,
            chunks: ids,
            garbage,
            writerDeviceId: record?.metadata.cloud?.writerDeviceId,
            writerLocalId: record?.metadata.id,
            sourceRevision: record?.metadata.revision,
            ...(record
              ? {
                  metadata: {
                    ...record.metadata,
                    id,
                    cloud: undefined,
                    uploadedAt: Date.now(),
                    uploadedMinute: record.save.game.date.minute,
                  },
                }
              : {}),
          }),
        ),
      );
      return garbage;
    });
    // Separating cleanup keeps replacement of two large revisions below the 10 MiB
    // transaction limit. The manifest remembers leftovers if cleanup is interrupted.
    await this.cleanup(uid, id, version, garbage).catch(() => undefined);
    return version;
  }

  private async cleanup(
    uid: string,
    id: string,
    version: string,
    garbage: string[],
  ): Promise<void> {
    for (let offset = 0; offset < garbage.length; offset += 10) {
      const batch = writeBatch(getDb());
      for (const blob of garbage.slice(offset, offset + 10))
        batch.delete(doc(getDb(), "saveBlobs", blob));
      await batch.commit();
    }
    if (!garbage.length) return;
    const ref = doc(getDb(), "users", uid, "cloudSaves", id);
    await runTransaction(getDb(), async (transaction) => {
      const latest = await transaction.get(ref);
      if (latest.data()?.version === version)
        transaction.update(ref, { garbage: [] });
    });
  }
}

/** Each link owns new immutable payloads; subsequent play, rename and deletion cannot alter it. */
export async function createSharedSave(
  uid: string,
  file: SaveFileType,
): Promise<string> {
  const chunks = saveChunks(file);
  const ids = chunks.map(() => newSaveId());
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newShareId();
    const ref = doc(getDb(), "sharedGames", id);
    const created = await runTransaction(getDb(), async (transaction) => {
      if ((await transaction.get(ref)).exists()) return false;
      const expiresAt = Timestamp.fromMillis(Date.now() + SHARE_LIFETIME_MS);
      chunks.forEach((data, index) =>
        transaction.set(doc(getDb(), "saveBlobs", ids[index]), {
          uid,
          shareId: id,
          data,
          expiresAt,
        }),
      );
      transaction.set(ref, {
        uid,
        chunks: ids,
        lastLoadedAt: serverTimestamp(),
        expiresAt,
      });
      return true;
    });
    if (created) return `https://electrifygame.com/?game=${id}`;
  }
  throw new Error("Couldn't create a share link. Please try again.");
}

export async function loadSharedSave(id: string): Promise<SaveFileType> {
  if (!SHARE_ID_PATTERN.test(id))
    throw new Error("This share link is invalid.");
  const ref = doc(getDb(), "sharedGames", id);
  const snapshot = await getDocFromServer(ref).catch((error: unknown) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "permission-denied" || code === "not-found")
      throw new Error(
        "This shared game has expired or is no longer available.",
      );
    throw error;
  });
  const data = snapshot.data();
  if (
    !data ||
    !(data.expiresAt instanceof Timestamp) ||
    data.expiresAt.toMillis() <= Date.now()
  )
    throw new Error("This shared game has expired or is no longer available.");
  if (
    !Array.isArray(data.chunks) ||
    !data.chunks.length ||
    data.chunks.length > 60 ||
    data.chunks.some(
      (chunk: unknown) =>
        typeof chunk !== "string" || !/^[a-f0-9]{32}$/.test(chunk),
    )
  )
    throw new Error("This shared game is invalid.");
  const file = await readFile(data.chunks);
  // Extend retention only after the whole snapshot has loaded and passed domain validation.
  await runTransaction(getDb(), async (transaction) => {
    const latest = await transaction.get(ref);
    if (!latest.exists())
      throw new Error("This shared game is no longer available.");
    const expiresAt = Timestamp.fromMillis(Date.now() + SHARE_LIFETIME_MS);
    transaction.update(ref, { lastLoadedAt: serverTimestamp(), expiresAt });
    data.chunks.forEach((chunk: string) =>
      transaction.update(doc(getDb(), "saveBlobs", chunk), { expiresAt }),
    );
  });
  return file;
}
