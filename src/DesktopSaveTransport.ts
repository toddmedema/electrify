import {
  CloudConflict,
  CloudSaveHead,
  CloudSaveTransport,
} from "./CloudSaveTransport";
import { DesktopBridge } from "./Desktop";
import { encodeSaveFile } from "./SaveFile";
import { parseSave } from "./SaveGame";
import { normalizeSaveName, validateSaveFileEnvelope } from "./SaveModel";
import {
  newSaveId,
  SaveRepository,
  SaveRepositoryBackup,
} from "./SaveRepository";
import type { SaveMetadata, SaveRecord } from "./Types";
import { isValidDifficulty } from "./helpers/Difficulty";
import { MONTHS } from "./Constants";

export interface DesktopCloudRecord {
  head: CloudSaveHead & { ancestors?: string[] };
  file?: unknown;
}
export interface DesktopSaveLibrary {
  version: 1;
  records: DesktopCloudRecord[];
  repository?: SaveRepositoryBackup;
}

/** Why a record can't be used, or undefined when it is valid. */
function recordProblem(
  entry: DesktopCloudRecord,
  ids: Set<string>,
): string | undefined {
  const head = entry?.head;
  if (
    !head ||
    !/^[a-f0-9]{32}$/.test(head.id) ||
    !/^[a-f0-9]{32}$/.test(head.version) ||
    typeof head.deleted !== "boolean" ||
    ids.has(head.id) ||
    (head.ancestors !== undefined &&
      (!Array.isArray(head.ancestors) ||
        head.ancestors.some(
          (id) => typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id),
        )))
  )
    return "The desktop save library contains an invalid backup.";
  if (head.deleted) return undefined;
  const metadata = head.metadata;
  if (
    !metadata ||
    typeof metadata.name !== "string" ||
    typeof metadata.createdAt !== "string" ||
    typeof metadata.savedAt !== "string" ||
    !Number.isSafeInteger(metadata.revision) ||
    metadata.revision < 1 ||
    !Number.isSafeInteger(metadata.scenarioId) ||
    typeof metadata.scenarioName !== "string" ||
    typeof metadata.locationName !== "string" ||
    !isValidDifficulty(metadata.difficulty) ||
    !["inProgress", "completed", "bankrupt", "fired"].includes(
      metadata.status,
    ) ||
    !metadata.date ||
    !MONTHS.includes(metadata.date.month) ||
    !Number.isInteger(metadata.date.year)
  )
    return "The desktop save library contains invalid metadata.";
  try {
    normalizeSaveName(metadata.name);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/**
 * Validates a device library. `skipInvalidRecords` drops records this version can't use, such
 * as those a newer game version wrote before a Steam branch downgrade, instead of rejecting the
 * whole library; the repository backup still preserves their saves.
 */
export function parseDesktopLibrary(
  raw: unknown,
  { skipInvalidRecords = false } = {},
): DesktopSaveLibrary {
  if (!raw || typeof raw !== "object")
    throw new Error("The desktop save library is invalid.");
  const library = raw as DesktopSaveLibrary;
  if (
    library.version !== 1 ||
    !Array.isArray(library.records) ||
    library.records.length > 10000
  )
    throw new Error("The desktop save library is invalid.");
  const ids = new Set<string>();
  const records: DesktopCloudRecord[] = [];
  for (const entry of library.records) {
    const problem = recordProblem(entry, ids);
    if (problem) {
      if (skipInvalidRecords) continue;
      throw new Error(problem);
    }
    ids.add(entry.head.id);
    records.push(entry);
  }
  return { ...library, records };
}

/** Device files never replace one another. Causal history ignores stale replicas; forks survive. */
export function mergeDesktopLibraries(
  libraries: DesktopSaveLibrary[],
): DesktopCloudRecord[] {
  const groups = new Map<string, Map<string, DesktopCloudRecord>>();
  for (const library of libraries)
    for (const entry of library.records) {
      if (!groups.has(entry.head.id)) groups.set(entry.head.id, new Map());
      const previous = groups.get(entry.head.id)!.get(entry.head.version);
      groups.get(entry.head.id)!.set(entry.head.version, {
        ...entry,
        head: {
          ...entry.head,
          ancestors: [
            ...new Set([
              ...(previous?.head.ancestors || []),
              ...(entry.head.ancestors || []),
            ]),
          ],
        },
      });
    }
  const merged: DesktopCloudRecord[] = [];
  for (const [id, variants] of groups) {
    const entries = [...variants.values()];
    const current = entries.filter(
      (entry) =>
        !entries.some((other) =>
          other.head.ancestors?.includes(entry.head.version),
        ),
    );
    current.sort(
      (a, b) =>
        Number(b.head.deleted) - Number(a.head.deleted) ||
        b.head.version.localeCompare(a.head.version),
    );
    const primary = current[0];
    if (!primary) continue;
    merged.push(primary);
    for (const branch of current.slice(1)) {
      if (
        branch.head.deleted ||
        JSON.stringify(branch.file) === JSON.stringify(primary.file)
      )
        continue;
      // The version is a stable, globally unique branch ID, so retries do not create more copies.
      const branchId = branch.head.version;
      if (groups.has(branchId)) continue;
      const metadata = branch.head.metadata;
      merged.push({
        ...branch,
        head: {
          ...branch.head,
          id: branchId,
          metadata: metadata
            ? {
                ...metadata,
                id: branchId,
                name: normalizeSaveName(
                  `${Array.from(metadata.name).slice(0, 42).join("")} (other device)`,
                ),
              }
            : undefined,
        },
      });
    }
    // Publish ancestry on the primary: after all branches are retained, replicas converge.
    primary.head = {
      ...primary.head,
      id,
      ancestors: [
        ...new Set([
          ...current.flatMap((entry) => entry.head.ancestors || []),
          ...current.slice(1).map((entry) => entry.head.version),
        ]),
      ],
    };
  }
  return merged;
}

export class DesktopSaveTransport implements CloudSaveTransport {
  private records = new Map<string, DesktopCloudRecord>();
  private activeUid?: string;
  constructor(
    private desktop: DesktopBridge,
    private repository: SaveRepository,
  ) {}

  async list(uid: string): Promise<CloudSaveHead[]> {
    this.activeUid = uid;
    const saved = await this.desktop.readSaveLibrary();
    if (saved.cloudState !== "ready")
      throw new Error(
        saved.cloudState === "disabled"
          ? "Steam Cloud is disabled. Saves remain on this device."
          : "Steam Cloud is unavailable. Saves remain on this device.",
      );
    const sources = saved.cloudCopies
      ? [...saved.cloudCopies]
      : saved.cloud
        ? [saved.cloud]
        : [];
    const libraries = sources.map((source) => parseDesktopLibrary(source));
    // The local catalog carries acknowledged versions and retained conflict branches. Like
    // startup, it skips records only a newer game version can read.
    if (saved.local)
      libraries.push(
        parseDesktopLibrary(saved.local, { skipInvalidRecords: true }),
      );
    this.records = new Map(
      mergeDesktopLibraries(libraries).map((entry) => [entry.head.id, entry]),
    );
    return [...this.records.values()].map((entry) => entry.head);
  }

  async read(head: CloudSaveHead): Promise<SaveRecord> {
    const entry = this.records.get(head.id);
    if (
      !entry ||
      entry.head.version !== head.version ||
      entry.head.deleted ||
      !head.metadata
    )
      throw new CloudConflict(
        "This Steam Cloud backup changed. Retry syncing.",
      );
    const file = validateSaveFileEnvelope(entry.file, parseSave);
    const metadata: SaveMetadata = {
      ...head.metadata,
      id: head.id,
      name: normalizeSaveName(head.metadata.name),
    };
    if (
      metadata.scenarioId !== file.save.game.scenarioId ||
      metadata.difficulty !== file.save.game.difficulty ||
      metadata.status !== file.status
    )
      throw new Error("This Steam Cloud backup has invalid metadata.");
    return { metadata, save: file.save, result: file.result };
  }

  async write(
    uid: string,
    id: string,
    expected: string | undefined,
    record: SaveRecord | null,
  ): Promise<string> {
    if (
      uid !== this.activeUid ||
      this.records.get(id)?.head.version !== expected
    )
      throw new CloudConflict(
        "This Steam Cloud backup changed. Retry syncing.",
      );
    const previousRecord = this.records.get(id);
    const previous = previousRecord?.head;
    const version = newSaveId();
    const head: DesktopCloudRecord["head"] = {
      id,
      version,
      deleted: !record,
      chunks: [],
      ancestors: [
        ...new Set([
          ...(previous?.ancestors || []),
          ...(previous ? [previous.version] : []),
        ]),
      ],
      ...(record
        ? {
            metadata: record.metadata,
            writerDeviceId: record.metadata.cloud?.writerDeviceId,
            writerLocalId: record.metadata.id,
            sourceRevision: record.metadata.revision,
            uploadedAt: Date.now(),
            uploadedMinute: record.save.game.date.minute,
          }
        : {}),
    };
    this.records.set(id, {
      head,
      ...(record
        ? {
            file: encodeSaveFile({
              name: record.metadata.name,
              status: record.metadata.status,
              save: record.save,
              result: record.result,
            }),
          }
        : {}),
    });
    // Durable disk succeeds independently of Steam; never acknowledge a failed cloud commit.
    try {
      const result = await this.desktop.writeSaveLibrary(
        await this.library(),
        true,
      );
      if (result.cloudState !== "ready")
        throw new Error(
          "Steam Cloud couldn't finish. The local game is safe; sync will retry.",
        );
      return version;
    } catch (error) {
      if (previousRecord) this.records.set(id, previousRecord);
      else this.records.delete(id);
      throw error;
    }
  }

  async library(): Promise<DesktopSaveLibrary> {
    return {
      version: 1,
      records: [...this.records.values()],
      repository: await this.repository.backup(),
    };
  }
  /** Checkpoint this device without reading the network; other devices use separate files. */
  async captureDevice(uid: string): Promise<void> {
    for (const entry of await this.repository.list()) {
      if (entry.cloud && entry.cloud.uid !== uid) continue;
      const id = entry.cloud?.id || entry.id;
      if (!entry.cloud) await this.repository.bindCloud(entry.id, uid, id);
      let record: SaveRecord;
      try {
        record = await this.repository.read(entry.id);
      } catch {
        // A damaged or newer-schema save stays in the repository backup for recovery. It must
        // not block every other save's checkpoint, or the quit handshake that depends on it.
        continue;
      }
      const previous = this.records.get(id)?.head;
      if (
        entry.cloud?.syncedRevision === entry.revision &&
        previous?.version === entry.cloud.version
      )
        continue;
      if (
        previous?.writerLocalId === entry.id &&
        previous.sourceRevision === entry.revision
      )
        continue;
      const version = newSaveId();
      const acknowledged = record.metadata.cloud?.version;
      const sameWriter =
        previous?.writerDeviceId === record.metadata.cloud?.writerDeviceId &&
        previous?.writerLocalId === record.metadata.id;
      this.records.set(id, {
        head: {
          id,
          version,
          deleted: false,
          chunks: [],
          metadata: record.metadata,
          writerDeviceId: record.metadata.cloud?.writerDeviceId,
          writerLocalId: record.metadata.id,
          sourceRevision: record.metadata.revision,
          ancestors: [
            ...new Set([
              ...(acknowledged ? [acknowledged] : []),
              ...(sameWriter && previous
                ? [previous.version, ...(previous.ancestors || [])]
                : previous?.version === acknowledged
                  ? previous?.ancestors || []
                  : []),
            ]),
          ],
          uploadedAt: Date.now(),
          uploadedMinute: record.save.game.date.minute,
        },
        file: encodeSaveFile({
          name: record.metadata.name,
          status: record.metadata.status,
          save: record.save,
          result: record.result,
        }),
      });
    }
    for (const deletion of await this.repository.pendingCloudDeletes(uid)) {
      const previous = this.records.get(deletion.id)?.head;
      if (previous?.deleted) continue;
      const sameWriter =
        previous?.writerDeviceId === deletion.writerDeviceId &&
        previous?.writerLocalId === deletion.writerLocalId;
      this.records.set(deletion.id, {
        head: {
          id: deletion.id,
          version: newSaveId(),
          deleted: true,
          chunks: [],
          ancestors: [
            ...new Set([
              ...(deletion.version ? [deletion.version] : []),
              ...(sameWriter && previous
                ? [previous.version, ...(previous.ancestors || [])]
                : previous?.version === deletion.version
                  ? previous?.ancestors || []
                  : []),
            ]),
          ],
        },
      });
    }
  }
  seed(library: DesktopSaveLibrary): void {
    this.records = new Map(
      library.records.map((entry) => [entry.head.id, entry]),
    );
  }
}
