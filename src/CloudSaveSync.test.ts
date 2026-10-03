import "fake-indexeddb/auto";
import { deserialize, serialize } from "v8";
import { webcrypto } from "crypto";
import { AUTO_CLOUD_SAVE_MS, CloudSaveSync } from "./CloudSaveSync";
import { CloudConflict } from "./CloudSaveTransport";
import type { CloudSaveHead, CloudSaveTransport } from "./CloudSaveTransport";
import { SaveRepository } from "./SaveRepository";
import { parseSave, serializeSave } from "./SaveGame";
import { fakeSaveGame } from "./testing/SaveTestHelpers";
import type { SaveRecord } from "./Types";
import { getDateFromMinute } from "./helpers/DateTime";
import { DAYS_PER_YEAR } from "./Constants";

jest.mock("./CloudSaveTransport", () => ({
  CloudConflict: class CloudConflict extends Error {},
}));

if (typeof structuredClone === "undefined") {
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: <T>(value: T): T => deserialize(serialize(value)),
  });
}
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class MemoryCloud implements CloudSaveTransport {
  public heads = new Map<string, CloudSaveHead>();
  public records = new Map<string, SaveRecord>();
  public beforeWrite?: (id: string, record: SaveRecord | null) => Promise<void>;
  public afterWrite?: (id: string, record: SaveRecord | null) => Promise<void>;
  private version = 0;

  async list(_uid: string): Promise<CloudSaveHead[]> {
    return structuredClone(Array.from(this.heads.values()));
  }
  async read(head: CloudSaveHead): Promise<SaveRecord> {
    const record = this.records.get(head.id);
    if (!record) throw new Error("Cloud payload missing");
    return structuredClone(record);
  }
  async write(
    _uid: string,
    id: string,
    expected: string | undefined,
    record: SaveRecord | null,
  ): Promise<string> {
    await this.beforeWrite?.(id, record);
    if (this.heads.get(id)?.version !== expected) throw new CloudConflict();
    const version = String(++this.version);
    this.heads.set(id, {
      id,
      version,
      deleted: !record,
      chunks: [],
      writerDeviceId: record?.metadata.cloud?.writerDeviceId,
      writerLocalId: record?.metadata.id,
      sourceRevision: record?.metadata.revision,
      uploadedAt: record ? Date.now() : undefined,
      uploadedMinute: record?.save.game.date.minute,
      metadata: record ? { ...record.metadata, id } : undefined,
    });
    if (record) this.records.set(id, structuredClone(record));
    else this.records.delete(id);
    await this.afterWrite?.(id, record);
    return version;
  }
}

describe("CloudSaveSync", () => {
  let databaseName: string;
  let repository: SaveRepository;
  let cloud: MemoryCloud;
  let sync: CloudSaveSync;

  beforeEach(() => {
    databaseName = `cloud-test-${Math.random()}`;
    repository = new SaveRepository(parseSave, {
      databaseName,
    });
    cloud = new MemoryCloud();
    sync = new CloudSaveSync(repository, cloud);
  });
  afterEach(() => repository.close());

  async function create(id = "first") {
    return repository.create({
      id,
      name: id,
      save: serializeSave(fakeSaveGame()),
      scenarioName: "Rise of Renewables",
    });
  }

  async function advance(id: string, minutes: number) {
    const { record, lease } = await repository.prepareResume(
      id,
      `writer-${id}`,
    );
    const game = record.save.game;
    await repository.writeSnapshot(
      lease,
      serializeSave({
        ...game,
        date: getDateFromMinute(game.date.minute + minutes, game.startingYear),
      }),
      record.metadata.scenarioName,
    );
    await repository.release(lease);
  }

  it("requires both five wall-clock minutes and a full game year for automatic uploads, even after reload", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      await create();
      await sync.sync("alice", undefined, { automatic: true });
      await advance("first", DAYS_PER_YEAR * 1440);
      clock.mockReturnValue(1_000_000 + AUTO_CLOUD_SAVE_MS - 1);
      await sync.sync("alice", undefined, { automatic: true });
      expect(cloud.heads.get("first")?.version).toBe("1");
      clock.mockReturnValue(1_000_000 + AUTO_CLOUD_SAVE_MS);
      repository.close();
      repository = new SaveRepository(parseSave, { databaseName });
      sync = new CloudSaveSync(repository, cloud);
      await sync.sync("alice", undefined, { automatic: true });
      expect(cloud.heads.get("first")?.version).toBe("2");
      await advance("first", DAYS_PER_YEAR * 1440 - 1);
      clock.mockReturnValue(1_000_000 + 2 * AUTO_CLOUD_SAVE_MS);
      await sync.sync("alice", undefined, { automatic: true });
      expect(cloud.heads.get("first")?.version).toBe("2");
      await advance("first", 1);
      await sync.sync("alice", undefined, { automatic: true });
      expect(cloud.heads.get("first")?.version).toBe("3");
    } finally {
      clock.mockRestore();
    }
  });

  it("allows an explicit save immediately and resets the automatic checkpoint only for that game", async () => {
    await create("first");
    await create("second");
    await sync.sync("alice");
    await repository.rename("first", "Explicit change");
    await repository.rename("second", "Automatic change");
    await sync.sync("alice", undefined, {
      automatic: true,
      forceIds: new Set(["first"]),
    });
    expect(cloud.records.get("first")?.metadata.name).toBe("Explicit change");
    expect(cloud.records.get("second")?.metadata.name).toBe("second");
    await repository.rename("first", "Another automatic change");
    await sync.sync("alice", undefined, { automatic: true });
    expect(cloud.records.get("first")?.metadata.name).toBe("Explicit change");
  });

  it("does not let automatic retries upload progress captured during the previous upload", async () => {
    await create();
    let change = true;
    cloud.beforeWrite = async () => {
      if (change) {
        change = false;
        await repository.rename("first", "New progress");
      }
    };
    await sync.sync("alice", undefined, { automatic: true });
    await sync.sync("alice", undefined, { automatic: true });
    expect(cloud.heads.get("first")?.version).toBe("1");
    expect((await repository.list())[0].cloud?.syncedRevision).toBeLessThan(
      (await repository.list())[0].revision,
    );
  });

  it("uploads a device save and restores it on another device", async () => {
    await create();
    await sync.sync("alice");
    expect((await repository.list())[0].cloud).toMatchObject({
      uid: "alice",
      id: "first",
      syncedRevision: 1,
    });
    const second = new SaveRepository(parseSave, {
      databaseName: `other-device-${Math.random()}`,
    });
    try {
      await new CloudSaveSync(second, cloud).sync("alice");
      expect((await second.read("first")).save.game.customerRate).toBe(0.07);
    } finally {
      second.close();
    }
  });

  it("keeps offline edits as independent branches", async () => {
    await create();
    await sync.sync("alice");
    const record = await repository.read("first");
    await repository.rename("first", "Offline change");
    await cloud.write("alice", "first", record.metadata.cloud?.version, {
      ...record,
      metadata: {
        ...record.metadata,
        name: "Other device change",
        cloud: { ...record.metadata.cloud!, writerDeviceId: "e".repeat(32) },
      },
    });
    const result = await sync.sync("alice");
    expect(result.conflicts).toBe(true);
    expect((await repository.list()).map((entry) => entry.name).sort()).toEqual(
      ["Offline change", "Other device change"],
    );
  });

  it("does not upload an earlier account's saves to a newly signed-in account", async () => {
    await create();
    await sync.sync("alice");
    cloud.heads.clear();
    cloud.records.clear();
    await sync.sync("bob");
    expect(cloud.heads.size).toBe(0);
    expect((await repository.list())[0].cloud?.uid).toBe("alice");
  });

  it("keeps the committed upload dirty when local progress advances during its request", async () => {
    await create();
    let advance = true;
    cloud.beforeWrite = async () => {
      if (advance) {
        advance = false;
        await repository.rename("first", "New progress");
      }
    };
    await sync.sync("alice");
    const [entry] = await repository.list();
    expect(entry.cloud?.syncedRevision).toBeLessThan(entry.revision);
    await sync.sync("alice");
    expect(cloud.records.get("first")?.metadata.name).toBe("New progress");
  });

  it("defers a newer backup while the device save has an active writer", async () => {
    await create();
    await sync.sync("alice");
    const record = await repository.read("first");
    const owner = await repository.prepareResume("first", "live-tab");
    await cloud.write("alice", "first", record.metadata.cloud?.version, {
      ...record,
      metadata: {
        ...record.metadata,
        name: "Other device progress",
        cloud: { ...record.metadata.cloud!, writerDeviceId: "e".repeat(32) },
      },
    });
    const result = await sync.sync("alice");
    expect(result.deferred).toBe(true);
    expect((await repository.read("first")).metadata.name).toBe("first");
    await repository.release(owner.lease);
    await sync.sync("alice");
    expect((await repository.read("first")).metadata.name).toBe(
      "Other device progress",
    );
  });

  it("propagates deleted backups to an unchanged device save", async () => {
    await create();
    await sync.sync("alice");
    const record = await repository.read("first");
    await cloud.write("alice", "first", record.metadata.cloud?.version, null);
    await sync.sync("alice");
    expect(await repository.list()).toEqual([]);
  });

  it("preserves a newer remote edit when an older device deletion arrives", async () => {
    await create();
    await sync.sync("alice");
    const record = await repository.read("first");
    await repository.delete("first");
    await cloud.write("alice", "first", record.metadata.cloud?.version, {
      ...record,
      metadata: {
        ...record.metadata,
        name: "Newer remote edit",
        cloud: { ...record.metadata.cloud!, writerDeviceId: "e".repeat(32) },
      },
    });
    await sync.sync("alice");
    expect((await repository.read("first")).metadata.name).toBe(
      "Newer remote edit",
    );
  });

  it("preserves new source-device progress after another device deletes a restored backup", async () => {
    await create();
    await sync.sync("alice");
    const original = await repository.read("first");
    const restored = new SaveRepository(parseSave, {
      databaseName: `restored-device-${Math.random()}`,
    });
    const restoredSync = new CloudSaveSync(restored, cloud);
    try {
      await restoredSync.sync("alice");
      await restored.delete("first");
      await cloud.write("alice", "first", original.metadata.cloud?.version, {
        ...original,
        metadata: {
          ...original.metadata,
          name: "Source device's new progress",
        },
      });
      await restoredSync.sync("alice");
      expect((await restored.read("first")).metadata.name).toBe(
        "Source device's new progress",
      );
      expect(cloud.heads.get("first")?.deleted).toBe(false);
    } finally {
      restored.close();
    }
  });

  it("keeps deletion durable while a different tab's first upload is in flight", async () => {
    await create();
    const started = deferred<void>();
    const finish = deferred<void>();
    cloud.beforeWrite = async (_id, record) => {
      if (record) {
        started.resolve();
        await finish.promise;
      }
    };
    const upload = sync.sync("alice");
    await started.promise;
    await repository.delete("first");
    await new CloudSaveSync(repository, cloud).sync("alice");
    finish.resolve();
    await upload;
    cloud.beforeWrite = undefined;
    await sync.sync("alice");
    expect(await repository.list()).toEqual([]);
    expect(cloud.heads.get("first")?.deleted).toBe(true);
  });

  it("keeps deletion durable while an existing backup upload commits before its acknowledgement", async () => {
    await create();
    await sync.sync("alice");
    await repository.rename("first", "Progress being uploaded");
    const committed = deferred<void>();
    const acknowledge = deferred<void>();
    cloud.afterWrite = async (_id, record) => {
      if (record) {
        committed.resolve();
        await acknowledge.promise;
      }
    };
    const upload = sync.sync("alice");
    await committed.promise;
    await repository.delete("first");
    await new CloudSaveSync(repository, cloud).sync("alice");
    acknowledge.resolve();
    await upload;
    cloud.afterWrite = undefined;
    await sync.sync("alice");
    expect(await repository.list()).toEqual([]);
    expect(cloud.heads.get("first")?.deleted).toBe(true);
  });

  it("acknowledges a committed upload when the account changes during the request", async () => {
    await create();
    let current = true;
    cloud.beforeWrite = async () => {
      current = false;
    };
    await sync.sync("alice", () => current);
    cloud.beforeWrite = undefined;
    await sync.sync("alice");
    expect((await repository.list()).map((entry) => entry.name)).toEqual([
      "first",
    ]);
    expect(cloud.heads.size).toBe(1);
  });

  it("does not fork a same-device upload visible before another tab acknowledges it", async () => {
    await create();
    await sync.sync("alice");
    await repository.rename("first", "Progress being uploaded");
    const committed = deferred<void>();
    const acknowledge = deferred<void>();
    let held = false;
    cloud.afterWrite = async (_id, record) => {
      if (record && !held) {
        held = true;
        committed.resolve();
        await acknowledge.promise;
      }
    };
    const upload = sync.sync("alice");
    await committed.promise;
    await new CloudSaveSync(repository, cloud).sync("alice");
    acknowledge.resolve();
    await upload;
    cloud.afterWrite = undefined;
    await sync.sync("alice");
    expect((await repository.list()).map((entry) => entry.name)).toEqual([
      "Progress being uploaded",
    ]);
    expect(cloud.heads.size).toBe(1);
  });

  it("reconciles a concurrent offline conflict once when two tabs sync together", async () => {
    await create();
    await sync.sync("alice");
    const record = await repository.read("first");
    await repository.rename("first", "Local branch");
    await cloud.write("alice", "first", record.metadata.cloud?.version, {
      ...record,
      metadata: {
        ...record.metadata,
        name: "Remote branch",
        cloud: { ...record.metadata.cloud!, writerDeviceId: "e".repeat(32) },
      },
    });
    const bothListed = deferred<void>();
    let lists = 0;
    const list = repository.list.bind(repository);
    const snapshot = jest
      .spyOn(repository, "list")
      .mockImplementation(async () => {
        const entries = await list();
        if (++lists <= 2) {
          if (lists === 2) bothListed.resolve();
          await bothListed.promise;
        }
        return entries;
      });
    const other = new CloudSaveSync(repository, cloud);
    const first = sync.sync("alice");
    const second = other.sync("alice");
    await Promise.all([first, second]);
    snapshot.mockRestore();
    await sync.sync("alice");
    expect((await repository.list()).map((entry) => entry.name).sort()).toEqual(
      ["Local branch", "Remote branch"],
    );
    expect(cloud.heads.size).toBe(2);
  });

  it("restores each cloud identity once when simultaneous downloads need a new local identity", async () => {
    const local = await create();
    await repository.bindCloud("first", "bob");
    await cloud.write("alice", "first", undefined, local);
    await Promise.all([
      sync.sync("alice"),
      new CloudSaveSync(repository, cloud).sync("alice"),
    ]);
    expect(
      (await repository.list()).filter((entry) => entry.cloud?.uid === "alice"),
    ).toHaveLength(1);
  });

  it("backs up healthy saves even when another device save has a damaged payload", async () => {
    await create("healthy");
    await create("damaged");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("payloads", "readwrite");
        transaction
          .objectStore("payloads")
          .put({ id: "damaged", save: { broken: "preserve for recovery" } });
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    const result = await sync.sync("alice");
    expect(result.failed).toBe(true);
    expect(cloud.records.get("healthy")?.metadata.name).toBe("healthy");
    expect(cloud.heads.has("damaged")).toBe(false);
    expect((await repository.readRaw("damaged")).payload).toMatchObject({
      save: { broken: "preserve for recovery" },
    });
  });

  it("backs up healthy saves even when another cloud head is invalid", async () => {
    await create("healthy");
    cloud.heads.set("damaged", {
      id: "damaged",
      version: "",
      deleted: false,
      chunks: [],
      invalid: true,
    });
    const result = await sync.sync("alice");
    expect(result.failed).toBe(true);
    expect(cloud.records.get("healthy")?.metadata.name).toBe("healthy");
    expect(cloud.heads.get("damaged")?.invalid).toBe(true);
  });
});
