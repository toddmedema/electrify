import { encodeSave } from "./SaveEncoding";
import {
  isResumableStatus,
  normalizeSaveName,
  parseSavedRunResult,
  SaveRepositoryError,
  sortSaves,
  validateStatusResult,
} from "./SaveModel";
import type {
  SaveGameType,
  SaveLease,
  SaveMetadata,
  SaveRecord,
  SavedRunResult,
  SaveStatus,
} from "./Types";

export { SaveRepositoryError } from "./SaveModel";
export const SAVE_DATABASE_NAME = "electrify-saves";
export const SAVE_DATABASE_VERSION = 2;
export const SAVE_LEASE_MS = 30_000;

interface SessionRecord {
  saveId: string;
  writerToken: string;
  expiresAt: number;
}

interface StoredPayload {
  id: string;
  save: unknown;
  result?: unknown;
}

export interface PendingCloudDelete {
  key: string;
  uid: string;
  id: string;
  version?: string;
  writerDeviceId?: string;
  writerLocalId?: string;
}

export interface CreateSaveOptions {
  id?: string;
  name: string;
  save: SaveGameType;
  scenarioName: string;
  status?: SaveStatus;
  result?: SavedRunResult;
  lastPlayedAt?: string;
  writerToken?: string;
}

interface RepositoryOptions {
  databaseName?: string;
  now?: () => number;
  leaseMs?: number;
}

/** Random identity is browser bookkeeping, and never participates in seeded game outcomes. */
export function newSaveId(): string {
  const values = new Uint8Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function databaseError(error: unknown): SaveRepositoryError {
  if (error instanceof SaveRepositoryError) return error;
  const name =
    error && typeof error === "object" && "name" in error ? error.name : "";
  return name === "QuotaExceededError"
    ? new SaveRepositoryError(
        "quota",
        "Browser storage is full. Export a save or delete an older game, then retry.",
      )
    : new SaveRepositoryError(
        "unavailable",
        "Browser storage is unavailable. Retry or export your current game.",
      );
}

/**
 * Native IndexedDB boundary. Validators are injected to keep the repository independent of the
 * catalogue, reducer and Store. Every promise resolves after the whole transaction commits.
 */
export class SaveRepository {
  private database?: IDBDatabase;
  private opening?: Promise<void>;
  private channel?: BroadcastChannel;
  private listeners = new Set<() => void>();
  private readonly databaseName: string;
  private readonly now: () => number;
  private readonly leaseMs: number;

  constructor(
    private readonly parseSave: (raw: unknown) => SaveGameType | null,
    options: RepositoryOptions = {},
  ) {
    this.databaseName = options.databaseName || SAVE_DATABASE_NAME;
    this.now = options.now || Date.now;
    this.leaseMs = options.leaseMs || SAVE_LEASE_MS;
  }

  initialize(): Promise<void> {
    if (this.database) return Promise.resolve();
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      let abandoned = false;
      let request: IDBOpenDBRequest;
      try {
        if (typeof indexedDB === "undefined")
          throw new Error("IndexedDB unavailable");
        request = indexedDB.open(this.databaseName, SAVE_DATABASE_VERSION);
      } catch (error) {
        reject(databaseError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("saves")) {
          database.createObjectStore("saves", { keyPath: "id" });
          database.createObjectStore("payloads", { keyPath: "id" });
          database.createObjectStore("sessions", { keyPath: "saveId" });
        }
        database.createObjectStore("sync", { keyPath: "key" });
      };
      request.onerror = () => reject(databaseError(request.error));
      request.onblocked = () => {
        abandoned = true;
        reject(
          new SaveRepositoryError(
            "unavailable",
            "Reload other Electrify tabs, then retry opening saved games.",
          ),
        );
      };
      request.onsuccess = () => {
        if (abandoned) {
          request.result.close();
          return;
        }
        this.database = request.result;
        this.database.onversionchange = () => this.close();
        if (typeof BroadcastChannel !== "undefined") {
          try {
            this.channel = new BroadcastChannel(`${this.databaseName}:changes`);
            this.channel.onmessage = () => this.emit();
          } catch (_error) {
            // Focus refresh remains available when browser privacy settings block notifications.
          }
        }
        resolve();
      };
    }).catch((error) => {
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.opening = undefined;
    this.channel?.close();
    this.channel = undefined;
  }

  private emit(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (_error) {
        // A notification failure cannot turn an already committed save into a failed write.
      }
    });
  }

  private changed(): void {
    this.emit();
    try {
      this.channel?.postMessage("changed");
    } catch (_error) {
      // Broadcast is a refresh hint; transactions enforce ownership and focus refresh recovers it.
    }
  }

  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (
      transaction: IDBTransaction,
      done: (result: T) => void,
      request: <V>(
        request: IDBRequest<V>,
        callback: (value: V) => void,
      ) => void,
      fail: (error: unknown) => void,
    ) => void,
  ): Promise<T> {
    await this.initialize();
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = this.database!.transaction(stores, mode);
      } catch (error) {
        reject(databaseError(error));
        return;
      }
      let result: T;
      let failure: SaveRepositoryError | undefined;
      const fail = (error: unknown) => {
        failure = databaseError(error);
        try {
          transaction.abort();
        } catch (_error) {
          reject(failure);
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(failure || databaseError(transaction.error));
      transaction.onerror = () => {
        /* onabort reports request failures after rollback. */
      };
      const request = <V>(
        pending: IDBRequest<V>,
        callback: (value: V) => void,
      ) => {
        pending.onsuccess = () => {
          try {
            callback(pending.result);
          } catch (error) {
            fail(error);
          }
        };
      };
      try {
        work(
          transaction,
          (value) => {
            result = value;
          },
          request,
          fail,
        );
      } catch (error) {
        fail(error);
      }
    });
  }

  list(): Promise<SaveMetadata[]> {
    return this.transaction<SaveMetadata[]>(
      ["saves"],
      "readonly",
      (tx, done, request) =>
        request(tx.objectStore("saves").getAll(), (entries: SaveMetadata[]) =>
          done(sortSaves(entries)),
        ),
    );
  }

  private summary(
    metadata: SaveMetadata,
    save: SaveGameType,
    scenarioName: string,
  ): SaveMetadata {
    return {
      ...metadata,
      savedAt: save.savedAt,
      scenarioId: save.game.scenarioId,
      scenarioName,
      locationName: save.game.location.name,
      difficulty: save.game.difficulty,
      date: { month: save.game.date.month, year: save.game.date.year },
    };
  }

  private prepare(
    save: SaveGameType,
    status: SaveStatus,
    result?: SavedRunResult,
  ): { save: SaveGameType; result?: SavedRunResult; wire: unknown } {
    const validSave = this.parseSave(save);
    const validResult =
      result === undefined ? undefined : parseSavedRunResult(result);
    if (
      !validSave ||
      validSave.game.replayPlayback ||
      validResult === null ||
      !validateStatusResult(status, validResult, validSave.game)
    ) {
      throw new SaveRepositoryError("invalid", "This game could not be saved.");
    }
    return {
      save: validSave,
      result: validResult,
      wire: encodeSave(validSave),
    };
  }

  private decode(
    metadata: SaveMetadata | undefined,
    payload: StoredPayload | undefined,
  ): SaveRecord {
    if (!metadata || !payload)
      throw new SaveRepositoryError(
        "missing",
        "This saved game was deleted or is no longer available.",
      );
    const save = this.parseSave(payload.save);
    const result =
      payload.result === undefined
        ? undefined
        : parseSavedRunResult(payload.result);
    if (
      !save ||
      save.game.replayPlayback ||
      result === null ||
      !validateStatusResult(metadata.status, result, save.game) ||
      metadata.scenarioId !== save.game.scenarioId ||
      metadata.difficulty !== save.game.difficulty ||
      !Number.isSafeInteger(metadata.revision) ||
      metadata.revision < 1
    ) {
      throw new SaveRepositoryError(
        "invalid",
        "This saved game is invalid and cannot be opened.",
      );
    }
    return { metadata, save, ...(result === undefined ? {} : { result }) };
  }

  async create(options: CreateSaveOptions): Promise<SaveRecord> {
    const name = normalizeSaveName(options.name);
    const status = options.status || "inProgress";
    const prepared = this.prepare(options.save, status, options.result);
    const id = options.id || newSaveId();
    const metadata = this.summary(
      {
        id,
        name,
        createdAt: new Date(this.now()).toISOString(),
        ...(options.lastPlayedAt ? { lastPlayedAt: options.lastPlayedAt } : {}),
        savedAt: prepared.save.savedAt,
        revision: 1,
        status,
        scenarioId: prepared.save.game.scenarioId,
        scenarioName: options.scenarioName,
        locationName: prepared.save.game.location.name,
        difficulty: prepared.save.game.difficulty,
        date: {
          month: prepared.save.game.date.month,
          year: prepared.save.game.date.year,
        },
      },
      prepared.save,
      options.scenarioName,
    );
    const record = await this.transaction<SaveRecord>(
      ["saves", "payloads", "sessions"],
      "readwrite",
      (tx, done, request) => {
        request(tx.objectStore("saves").get(id), (existing) => {
          if (existing)
            throw new SaveRepositoryError(
              "conflict",
              "A save with this identity already exists.",
            );
          tx.objectStore("saves").add(metadata);
          tx.objectStore("payloads").add({
            id,
            save: prepared.wire,
            result: prepared.result,
          });
          if (options.writerToken && isResumableStatus(status)) {
            tx.objectStore("sessions").put({
              saveId: id,
              writerToken: options.writerToken,
              expiresAt: this.now() + this.leaseMs,
            });
          }
          done({
            metadata,
            save: prepared.save,
            ...(prepared.result ? { result: prepared.result } : {}),
          });
        });
      },
    );
    this.changed();
    return record;
  }

  async read(id: string): Promise<SaveRecord> {
    const [metadata, payload] = await this.transaction<
      [SaveMetadata | undefined, StoredPayload | undefined]
    >(["saves", "payloads"], "readonly", (tx, done, request) => {
      request(
        tx.objectStore("saves").get(id),
        (metadata: SaveMetadata | undefined) => {
          request(
            tx.objectStore("payloads").get(id),
            (payload: StoredPayload | undefined) => done([metadata, payload]),
          );
        },
      );
    });
    return this.decode(metadata, payload);
  }

  /** Recovery export preserves damaged data without treating it as a playable game. */
  readRaw(id: string): Promise<{ metadata: SaveMetadata; payload: unknown }> {
    return this.transaction<{ metadata: SaveMetadata; payload: unknown }>(
      ["saves", "payloads"],
      "readonly",
      (tx, done, request) => {
        request(
          tx.objectStore("saves").get(id),
          (metadata: SaveMetadata | undefined) => {
            if (!metadata) {
              throw new SaveRepositoryError(
                "missing",
                "This saved game is no longer available.",
              );
            }
            request(tx.objectStore("payloads").get(id), (payload: unknown) =>
              done({ metadata, payload }),
            );
          },
        );
      },
    );
  }

  async prepareResume(
    id: string,
    writerToken: string,
    expectedRevision?: number,
  ): Promise<{ record: SaveRecord; lease: SaveLease }> {
    const candidate = await this.transaction<{
      metadata: SaveMetadata;
      payload: StoredPayload;
      lease: SaveLease;
    }>(["saves", "payloads", "sessions"], "readwrite", (tx, done, request) => {
      request(
        tx.objectStore("saves").get(id),
        (metadata: SaveMetadata | undefined) => {
          if (!metadata)
            throw new SaveRepositoryError(
              "missing",
              "This saved game is no longer available.",
            );
          if (!isResumableStatus(metadata.status))
            throw new SaveRepositoryError(
              "invalid",
              "This game has ended. View its result instead.",
            );
          if (
            expectedRevision !== undefined &&
            metadata.revision !== expectedRevision
          )
            throw new SaveRepositoryError(
              "conflict",
              "This game changed in another tab. Reopen its latest save.",
            );
          request(
            tx.objectStore("payloads").get(id),
            (payload: StoredPayload | undefined) => {
              if (!payload)
                throw new SaveRepositoryError(
                  "missing",
                  "This saved game's data is no longer available.",
                );
              request(
                tx.objectStore("sessions").get(id),
                (owner: SessionRecord | undefined) => {
                  if (
                    owner &&
                    owner.expiresAt > this.now() &&
                    owner.writerToken !== writerToken
                  )
                    throw new SaveRepositoryError(
                      "conflict",
                      "This game is open in another tab.",
                    );
                  tx.objectStore("sessions").put({
                    saveId: id,
                    writerToken,
                    expiresAt: this.now() + this.leaseMs,
                  });
                  done({
                    metadata,
                    payload,
                    lease: {
                      saveId: id,
                      writerToken,
                      revision: metadata.revision,
                    },
                  });
                },
              );
            },
          );
        },
      );
    });
    try {
      return {
        record: this.decode(candidate.metadata, candidate.payload),
        lease: candidate.lease,
      };
    } catch (error) {
      await this.release(candidate.lease);
      throw error;
    }
  }

  private guard(
    metadata: SaveMetadata | undefined,
    owner: SessionRecord | undefined,
    lease?: SaveLease,
  ): SaveMetadata {
    if (!metadata)
      throw new SaveRepositoryError(
        "missing",
        "This saved game is no longer available.",
      );
    if (lease) {
      if (
        metadata.revision !== lease.revision ||
        owner?.writerToken !== lease.writerToken ||
        owner.expiresAt <= this.now()
      ) {
        throw new SaveRepositoryError(
          "conflict",
          "This game changed or its session expired. Reopen its latest save; you can export your current progress.",
        );
      }
    } else if (owner && owner.expiresAt > this.now()) {
      throw new SaveRepositoryError(
        "conflict",
        "This game is open in another tab.",
      );
    }
    return metadata;
  }

  private mutate<T>(
    id: string,
    lease: SaveLease | undefined,
    mutation: (tx: IDBTransaction, metadata: SaveMetadata) => T,
  ): Promise<T> {
    return this.transaction<T>(
      ["saves", "payloads", "sessions", "sync"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("saves").get(id),
          (metadata: SaveMetadata | undefined) => {
            request(
              tx.objectStore("sessions").get(id),
              (owner: SessionRecord | undefined) =>
                done(mutation(tx, this.guard(metadata, owner, lease))),
            );
          },
        );
      },
    );
  }

  async markOpened(lease: SaveLease): Promise<SaveLease> {
    const metadata = await this.mutate(lease.saveId, lease, (tx, metadata) => {
      if (!isResumableStatus(metadata.status))
        throw new SaveRepositoryError("invalid", "This game has ended.");
      const next = {
        ...metadata,
        lastPlayedAt: new Date(this.now()).toISOString(),
        revision: metadata.revision + 1,
      };
      tx.objectStore("saves").put(next);
      tx.objectStore("sessions").put({
        saveId: lease.saveId,
        writerToken: lease.writerToken,
        expiresAt: this.now() + this.leaseMs,
      });
      return next;
    });
    this.changed();
    return { ...lease, revision: metadata.revision };
  }

  renew(lease: SaveLease): Promise<void> {
    return this.transaction<void>(
      ["saves", "sessions"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("saves").get(lease.saveId),
          (metadata: SaveMetadata | undefined) => {
            if (!metadata)
              throw new SaveRepositoryError(
                "missing",
                "This saved game is no longer available.",
              );
            if (
              metadata.revision !== lease.revision ||
              !isResumableStatus(metadata.status)
            )
              throw new SaveRepositoryError(
                "conflict",
                "This game changed in another tab. Reopen its latest save.",
              );
            request(
              tx.objectStore("sessions").get(lease.saveId),
              (owner: SessionRecord | undefined) => {
                if (
                  owner &&
                  owner.expiresAt > this.now() &&
                  owner.writerToken !== lease.writerToken
                )
                  throw new SaveRepositoryError(
                    "conflict",
                    "This game is open in another tab.",
                  );
                tx.objectStore("sessions").put({
                  saveId: lease.saveId,
                  writerToken: lease.writerToken,
                  expiresAt: this.now() + this.leaseMs,
                });
                done(undefined);
              },
            );
          },
        );
      },
    );
  }

  async rename(
    id: string,
    name: string,
    lease?: SaveLease,
  ): Promise<SaveMetadata> {
    const validName = normalizeSaveName(name);
    const metadata = await this.mutate(id, lease, (tx, metadata) => {
      const next = {
        ...metadata,
        name: validName,
        revision: metadata.revision + 1,
      };
      tx.objectStore("saves").put(next);
      return next;
    });
    this.changed();
    return metadata;
  }

  async writeSnapshot(
    lease: SaveLease,
    save: SaveGameType,
    scenarioName: string,
  ): Promise<SaveMetadata> {
    // Encode before opening the transaction: expensive work cannot extend its active lifetime.
    const validSave = this.parseSave(save);
    if (!validSave || validSave.game.replayPlayback)
      throw new SaveRepositoryError("invalid", "This game could not be saved.");
    const wire = encodeSave(validSave);
    const metadata = await this.transaction<SaveMetadata>(
      ["saves", "payloads", "sessions"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("saves").get(lease.saveId),
          (metadata: SaveMetadata | undefined) => {
            request(
              tx.objectStore("sessions").get(lease.saveId),
              (owner: SessionRecord | undefined) => {
                const current = this.guard(metadata, owner, lease);
                if (!isResumableStatus(current.status))
                  throw new SaveRepositoryError(
                    "invalid",
                    "This game has ended and can no longer be updated.",
                  );
                if (
                  current.scenarioId !== validSave.game.scenarioId ||
                  current.difficulty !== validSave.game.difficulty
                )
                  throw new SaveRepositoryError(
                    "invalid",
                    "This snapshot belongs to a different game.",
                  );
                request(
                  tx.objectStore("payloads").get(lease.saveId),
                  (payload: StoredPayload | undefined) => {
                    if (!payload)
                      throw new SaveRepositoryError(
                        "missing",
                        "This saved game's data is no longer available.",
                      );
                    const result =
                      payload.result === undefined
                        ? undefined
                        : parseSavedRunResult(payload.result);
                    if (
                      result === null ||
                      !validateStatusResult(
                        current.status,
                        result,
                        validSave.game,
                      )
                    )
                      throw new SaveRepositoryError(
                        "invalid",
                        "This saved game's result is invalid.",
                      );
                    const next = this.summary(
                      { ...current, revision: current.revision + 1 },
                      validSave,
                      scenarioName,
                    );
                    tx.objectStore("saves").put(next);
                    tx.objectStore("payloads").put({
                      id: lease.saveId,
                      save: wire,
                      result,
                    });
                    tx.objectStore("sessions").put({
                      saveId: lease.saveId,
                      writerToken: lease.writerToken,
                      expiresAt: this.now() + this.leaseMs,
                    });
                    done(next);
                  },
                );
              },
            );
          },
        );
      },
    );
    this.changed();
    return metadata;
  }

  async recordOutcome(
    lease: SaveLease,
    save: SaveGameType,
    scenarioName: string,
    result: SavedRunResult,
  ): Promise<SaveMetadata> {
    const prepared = this.prepare(save, result.outcome, result);
    const metadata = await this.mutate(lease.saveId, lease, (tx, metadata) => {
      if (!isResumableStatus(metadata.status))
        throw new SaveRepositoryError(
          "invalid",
          "This game has already ended.",
        );
      if (
        metadata.scenarioId !== prepared.save.game.scenarioId ||
        metadata.difficulty !== prepared.save.game.difficulty
      )
        throw new SaveRepositoryError(
          "invalid",
          "This result belongs to a different game.",
        );
      const next = this.summary(
        {
          ...metadata,
          status: result.outcome,
          revision: metadata.revision + 1,
        },
        prepared.save,
        scenarioName,
      );
      tx.objectStore("saves").put(next);
      tx.objectStore("payloads").put({
        id: lease.saveId,
        save: prepared.wire,
        result: prepared.result,
      });
      if (isResumableStatus(result.outcome)) {
        tx.objectStore("sessions").put({
          saveId: lease.saveId,
          writerToken: lease.writerToken,
          expiresAt: this.now() + this.leaseMs,
        });
      } else tx.objectStore("sessions").delete(lease.saveId);
      return next;
    });
    this.changed();
    return metadata;
  }

  async delete(id: string, lease?: SaveLease): Promise<void> {
    await this.mutate(id, lease, (tx, metadata) => {
      if (metadata.cloud) {
        const { uid, id: cloudId, version, writerDeviceId } = metadata.cloud;
        tx.objectStore("sync").put({
          key: `${uid}:${cloudId}`,
          uid,
          id: cloudId,
          version,
          writerDeviceId,
          writerLocalId: metadata.id,
        });
      }
      tx.objectStore("saves").delete(id);
      tx.objectStore("payloads").delete(id);
      tx.objectStore("sessions").delete(id);
    });
    this.changed();
  }

  release(lease: SaveLease): Promise<void> {
    return this.transaction<void>(
      ["sessions"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("sessions").get(lease.saveId),
          (owner: SessionRecord | undefined) => {
            if (owner?.writerToken === lease.writerToken)
              tx.objectStore("sessions").delete(lease.saveId);
            done(undefined);
          },
        );
      },
    );
  }

  /** Bind before uploading, so a concurrent local deletion always queues a cloud deletion. */
  async bindCloud(
    id: string,
    uid: string,
    cloudId = id,
    expected?: SaveMetadata,
  ): Promise<boolean> {
    const writerDeviceId = await this.transaction<string>(
      ["sync"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("sync").get("device"),
          (record: { value: string } | undefined) => {
            const value = record?.value || newSaveId();
            if (!record) tx.objectStore("sync").put({ key: "device", value });
            done(value);
          },
        );
      },
    );
    return this.transaction<boolean>(
      ["saves"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("saves").get(id),
          (metadata: SaveMetadata | undefined) => {
            if (
              expected &&
              (metadata?.cloud?.uid !== expected.cloud?.uid ||
                metadata?.cloud?.id !== expected.cloud?.id ||
                metadata?.cloud?.version !== expected.cloud?.version)
            ) {
              done(false);
              return;
            }
            if (!metadata || (metadata.cloud && metadata.cloud.uid !== uid))
              throw new SaveRepositoryError(
                "conflict",
                "This save belongs to another account.",
              );
            tx.objectStore("saves").put({
              ...metadata,
              cloud:
                metadata.cloud?.id === cloudId
                  ? { ...metadata.cloud, writerDeviceId }
                  : { uid, id: cloudId, writerDeviceId },
            });
            done(true);
          },
        );
      },
    );
  }

  async acknowledgeCloud(
    id: string,
    uid: string,
    cloudId: string,
    revision: number,
    version: string,
    checkpoint?: Pick<
      NonNullable<SaveMetadata["cloud"]>,
      "uploadedAt" | "uploadedMinute"
    >,
  ): Promise<void> {
    await this.transaction<void>(
      ["saves", "sync"],
      "readwrite",
      (tx, done, request) => {
        request(
          tx.objectStore("saves").get(id),
          (metadata: SaveMetadata | undefined) => {
            if (metadata?.cloud?.uid === uid && metadata.cloud.id === cloudId) {
              if ((metadata.cloud.syncedRevision || 0) > revision) {
                done(undefined);
                return;
              }
              tx.objectStore("saves").put({
                ...metadata,
                cloud: {
                  uid,
                  id: cloudId,
                  version,
                  syncedRevision: revision,
                  writerDeviceId: metadata.cloud.writerDeviceId,
                  uploadedAt:
                    checkpoint?.uploadedAt ?? metadata.cloud.uploadedAt,
                  uploadedMinute:
                    checkpoint?.uploadedMinute ?? metadata.cloud.uploadedMinute,
                },
              });
            } else {
              // Deletion can commit while the upload is in flight. Persist its new cloud version.
              request(
                tx.objectStore("sync").get(`${uid}:${cloudId}`),
                (pending: PendingCloudDelete | undefined) => {
                  if (pending)
                    tx.objectStore("sync").put({ ...pending, version });
                },
              );
            }
            done(undefined);
          },
        );
      },
    );
  }

  pendingCloudDeletes(uid: string): Promise<PendingCloudDelete[]> {
    return this.transaction(["sync"], "readonly", (tx, done, request) => {
      request(
        tx.objectStore("sync").getAll(),
        (entries: PendingCloudDelete[]) =>
          done(entries.filter((entry) => entry.uid === uid)),
      );
    });
  }

  clearCloudDelete(key: string): Promise<void> {
    return this.transaction(["sync"], "readwrite", (tx, done) => {
      tx.objectStore("sync").delete(key);
      done(undefined);
    });
  }

  /** Cloud restore never replaces a live writer or a revision edited during the download. */
  async applyCloud(
    uid: string,
    cloudId: string,
    version: string,
    record: SaveRecord | null,
    expected?: SaveMetadata,
  ): Promise<boolean> {
    const prepared = record
      ? this.prepare(record.save, record.metadata.status, record.result)
      : undefined;
    const applied = await this.transaction<boolean>(
      ["saves", "payloads", "sessions", "sync"],
      "readwrite",
      (tx, done, request) => {
        request(tx.objectStore("saves").getAll(), (entries: SaveMetadata[]) => {
          // Dedupe by cloud identity inside the transaction, including when the
          // same cloud ID was restored under a different local ID after a fork.
          if (
            !expected &&
            entries.some(
              (entry) => entry.cloud?.uid === uid && entry.cloud.id === cloudId,
            )
          ) {
            done(false);
            return;
          }
          const id =
            expected?.id ||
            (entries.some((entry) => entry.id === cloudId)
              ? newSaveId()
              : cloudId);
          const current = entries.find((entry) => entry.id === id);
          if (
            expected
              ? current?.revision !== expected.revision ||
                current?.cloud?.version !== expected.cloud?.version ||
                current?.cloud?.id !== expected.cloud?.id ||
                current?.cloud?.uid !== expected.cloud?.uid
              : !!current
          ) {
            done(false);
            return;
          }
          request(
            tx.objectStore("sessions").get(id),
            (owner: SessionRecord | undefined) => {
              if (owner && owner.expiresAt > this.now()) {
                done(false);
                return;
              }
              request(
                tx.objectStore("sync").get(`${uid}:${cloudId}`),
                (pending: PendingCloudDelete | undefined) => {
                  if (pending) {
                    done(false);
                    return;
                  }
                  if (record && prepared) {
                    const revision = (current?.revision || 0) + 1;
                    tx.objectStore("saves").put({
                      ...record.metadata,
                      id,
                      name: normalizeSaveName(record.metadata.name),
                      revision,
                      cloud: {
                        uid,
                        id: cloudId,
                        version,
                        syncedRevision: revision,
                        uploadedAt: this.now(),
                        uploadedMinute: record.save.game.date.minute,
                      },
                    });
                    tx.objectStore("payloads").put({
                      id,
                      save: prepared.wire,
                      result: prepared.result,
                    });
                  } else {
                    tx.objectStore("saves").delete(id);
                    tx.objectStore("payloads").delete(id);
                  }
                  tx.objectStore("sessions").delete(id);
                  done(true);
                },
              );
            },
          );
        });
      },
    );
    if (applied) this.changed();
    return applied;
  }
}
