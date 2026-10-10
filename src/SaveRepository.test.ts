import "fake-indexeddb/auto";
import { deserialize, serialize } from "v8";
import { SaveRepository } from "./SaveRepository";
import { parseSave, serializeSave } from "./SaveGame";
import { fakeSaveGame, fakeSavedResult } from "./testing/SaveTestHelpers";
import type { SaveLease } from "./Types";
import legacyFile from "./testing/fixtures/saves/legacy-rules-save.json";
import { SAVE_SCHEMA_VERSION } from "./SaveUpgrade";

// jsdom omits Node's native structuredClone; IndexedDB still needs a real structured clone.
if (typeof structuredClone === "undefined") {
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: <T>(value: T): T => deserialize(serialize(value)),
  });
}

describe("SaveRepository", () => {
  let now: number;
  let repository: SaveRepository;
  let other: SaveRepository;
  let databaseName: string;

  beforeEach(() => {
    now = Date.parse("2026-01-01T00:00:00.000Z");
    databaseName = `save-test-${Math.random()}`;
    repository = new SaveRepository(parseSave, {
      databaseName,
      now: () => now,
      leaseMs: 1000,
    });
    other = new SaveRepository(parseSave, {
      databaseName,
      now: () => now,
      leaseMs: 1000,
    });
  });

  afterEach(() => {
    repository.close();
    other.close();
    jest.restoreAllMocks();
  });

  async function create(id = "first", writerToken = "tab-one") {
    return repository.create({
      id,
      name: id,
      save: serializeSave(fakeSaveGame()),
      scenarioName: "Rise of Renewables",
      writerToken,
    });
  }

  function lease(
    id = "first",
    revision = 1,
    writerToken = "tab-one",
  ): SaveLease {
    return { saveId: id, revision, writerToken };
  }

  async function mutateStoredPayload(
    edit: (payload: Record<string, unknown>) => void,
    remove = false,
  ) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("payloads", "readwrite");
      const store = transaction.objectStore("payloads");
      const request = store.get("first");
      request.onsuccess = () => {
        const payload = request.result;
        if (remove) store.delete("first");
        else {
          edit(payload);
          store.put(payload);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }

  it("keeps independent slots for identical scenarios and seeds, listing metadata alone", async () => {
    await create();
    await create("second");
    const requests: string[] = [];
    const getAll = IDBObjectStore.prototype.getAll;
    jest.spyOn(IDBObjectStore.prototype, "getAll").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof getAll>
    ) {
      requests.push(this.name);
      return getAll.apply(this, args);
    });
    const entries = await repository.list();
    expect(entries).toHaveLength(2);
    expect(entries.map(({ scenarioId }) => scenarioId)).toEqual([101, 101]);
    expect(entries[0]).not.toHaveProperty("game");
    expect(entries[0]).not.toHaveProperty("result");
    expect(requests).toEqual(["saves"]);
    await expect(create()).rejects.toMatchObject({ code: "conflict" });
    expect((await repository.read("first")).save.game.seed).toBe(31337);
  });

  it("reads and checkpoints a legacy device save while retaining its original until the next write", async () => {
    await create();
    await mutateStoredPayload((payload) => {
      payload.save = legacyFile.save;
    });
    const original = await repository.readRaw("first");
    const { record, lease: reserved } = await repository.prepareResume(
      "first",
      "tab-one",
    );
    expect(record.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(record.save.game.customerRate).toBe(0.081);
    expect(record.save.game.runIdentity?.compatibilityId).not.toBe(
      legacyFile.save.game.runIdentity.compatibilityId,
    );
    expect(await repository.readRaw("first")).toEqual(original);
    await repository.writeSnapshot(
      reserved,
      serializeSave(record.save.game),
      "Rise of Renewables",
    );
    expect((await repository.readRaw("first")).payload).toMatchObject({
      save: {
        schemaVersion: SAVE_SCHEMA_VERSION,
        game: { runIdentity: record.save.game.runIdentity },
      },
    });
  });

  it("keeps a device save from a newer app intact and explains it", async () => {
    await create();
    await mutateStoredPayload((payload) => {
      payload.save = {
        ...(payload.save as object),
        schemaVersion: SAVE_SCHEMA_VERSION + 1,
      };
    });
    const original = await repository.readRaw("first");
    await expect(repository.read("first")).rejects.toMatchObject({
      code: "incompatible",
    });
    expect(await repository.readRaw("first")).toEqual(original);
  });

  it("acquires metadata, payload and revision atomically and excludes other live writers", async () => {
    await create();
    await expect(other.prepareResume("first", "tab-two")).rejects.toMatchObject(
      { code: "conflict" },
    );
    expect((await other.read("first")).metadata.id).toBe("first");
    await repository.release(lease());
    const prepared = await other.prepareResume("first", "tab-two");
    expect(prepared.lease).toEqual(lease("first", 1, "tab-two"));
    expect(prepared.record.metadata.revision).toBe(prepared.lease.revision);
    await expect(repository.rename("first", "New name")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(repository.delete("first")).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("marks successfully opened games only while ownership/revision are current", async () => {
    await create();
    expect((await repository.list())[0].lastPlayedAt).toBeUndefined();
    now += 1001;
    await expect(repository.markOpened(lease())).rejects.toMatchObject({
      code: "conflict",
    });
    await repository.renew(lease());
    const opened = await repository.markOpened(lease());
    expect(opened.revision).toBe(2);
    expect((await repository.list())[0].lastPlayedAt).toBe(
      new Date(now).toISOString(),
    );
    await repository.renew(opened);
    expect((await repository.list())[0].revision).toBe(2);
  });

  it("fences sleeping tabs after another writer advances the content revision", async () => {
    await create();
    now += 1001;
    const acquired = await other.prepareResume("first", "tab-two");
    const written = await other.writeSnapshot(
      acquired.lease,
      serializeSave(fakeSaveGame({ customerRate: 0.09 })),
      "Rise of Renewables",
    );
    expect(written.revision).toBe(2);
    now += 1001;
    await expect(repository.renew(lease())).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      repository.writeSnapshot(
        lease(),
        serializeSave(fakeSaveGame()),
        "Rise of Renewables",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      repository.prepareResume("first", "tab-one", 1),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await repository.read("first")).save.game.customerRate).toBe(0.09);
  });

  it("merges renamed metadata into later autosaves without changing played order", async () => {
    await create();
    const renamed = await repository.rename(
      "first",
      " 🌱 Better name ",
      lease(),
    );
    expect(renamed.name).toBe("🌱 Better name");
    const written = await repository.writeSnapshot(
      lease("first", renamed.revision),
      serializeSave(fakeSaveGame({ customerRate: 0.08 })),
      "Rise of Renewables",
    );
    expect(written.name).toBe("🌱 Better name");
    expect(written.lastPlayedAt).toBeUndefined();
    expect((await repository.read("first")).save.game.customerRate).toBe(0.08);
  });

  it("preserves a completed result during Keep playing and replaces it with a terminal failure", async () => {
    await create();
    const completed = await repository.recordOutcome(
      lease(),
      serializeSave(fakeSaveGame()),
      "Rise of Renewables",
      fakeSavedResult(),
    );
    const continued = await repository.writeSnapshot(
      lease("first", completed.revision),
      serializeSave(fakeSaveGame({ customerRate: 0.08 })),
      "Rise of Renewables",
    );
    expect(continued.status).toBe("completed");
    expect((await repository.read("first")).result).toEqual(fakeSavedResult());
    const failure = fakeSavedResult({ outcome: "bankrupt", score: 350 });
    const ended = await repository.recordOutcome(
      lease("first", continued.revision),
      serializeSave(fakeSaveGame()),
      "Rise of Renewables",
      failure,
    );
    expect(ended.status).toBe("bankrupt");
    expect((await repository.read("first")).result).toEqual(failure);
    await expect(other.prepareResume("first", "tab-two")).rejects.toMatchObject(
      { code: "invalid" },
    );
    // Terminal commit releases ownership, so another tab may manage the finished entry.
    await other.rename("first", "The failed experiment");
  });

  it("creates pending terminal outcomes directly with the original identity", async () => {
    const record = await repository.create({
      id: "first",
      name: "First",
      save: serializeSave(fakeSaveGame()),
      scenarioName: "Rise of Renewables",
      writerToken: "tab-one",
      status: "fired",
      result: fakeSavedResult({ outcome: "fired" }),
    });
    expect(record.metadata.status).toBe("fired");
    await other.delete("first");
    await expect(repository.read("first")).rejects.toMatchObject({
      code: "missing",
    });
  });

  it("deletes every store and never recreates a record through a late snapshot", async () => {
    await create();
    await repository.delete("first", lease());
    expect(await repository.list()).toEqual([]);
    await expect(
      repository.writeSnapshot(
        lease(),
        serializeSave(fakeSaveGame()),
        "Rise of Renewables",
      ),
    ).rejects.toMatchObject({ code: "missing" });
    expect(await repository.list()).toEqual([]);
  });

  it("rolls back metadata when a payload write fails and reports quota specifically", async () => {
    await create();
    const put = IDBObjectStore.prototype.put;
    const mocked = jest
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<typeof put>
      ) {
        if (this.name === "payloads")
          throw new DOMException("Full", "QuotaExceededError");
        return put.apply(this, args);
      });
    await expect(
      repository.writeSnapshot(
        lease(),
        serializeSave(fakeSaveGame({ customerRate: 0.09 })),
        "Rise of Renewables",
      ),
    ).rejects.toMatchObject({ code: "quota" });
    mocked.mockRestore();
    const unchanged = await repository.read("first");
    expect(unchanged.metadata.revision).toBe(1);
    expect(unchanged.save.game.customerRate).toBe(0.07);
  });

  it("releases ownership when resume payload validation fails", async () => {
    await create();
    await repository.release(lease());
    await mutateStoredPayload((payload) => {
      payload.save = { not: "a game" };
    });
    await expect(
      repository.prepareResume("first", "tab-one"),
    ).rejects.toMatchObject({ code: "invalid" });
    // This is an invalid-payload error again, not a leaked-lease writer conflict.
    await expect(other.prepareResume("first", "tab-two")).rejects.toMatchObject(
      { code: "invalid" },
    );
    expect(await repository.list()).toHaveLength(1);
  });

  it("returns damaged raw data for recovery while valid reads reject and healthy saves stay listed", async () => {
    await create();
    await create("second");
    await mutateStoredPayload((payload) => {
      payload.save = { broken: "original data" };
    });
    await expect(repository.read("first")).rejects.toMatchObject({
      code: "invalid",
    });
    const raw = await repository.readRaw("first");
    expect(raw.metadata.id).toBe("first");
    expect(raw.payload).toEqual({
      id: "first",
      save: { broken: "original data" },
      result: undefined,
    });
    expect((await repository.list()).map(({ id }) => id)).toEqual([
      "first",
      "second",
    ]);
    expect((await repository.read("second")).metadata.id).toBe("second");
    await expect(repository.readRaw("missing")).rejects.toMatchObject({
      code: "missing",
    });
  });

  it("preserves metadata for partial recovery when the payload record is missing", async () => {
    await create();
    await mutateStoredPayload(() => {}, true);
    await expect(repository.read("first")).rejects.toMatchObject({
      code: "missing",
    });
    expect(await repository.readRaw("first")).toMatchObject({
      metadata: { id: "first" },
      payload: undefined,
    });
  });

  it("notifies subscribers after committed changes, without notifying failed writes", async () => {
    const listener = jest.fn();
    const unsubscribe = repository.subscribe(listener);
    await create();
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(repository.rename("first", "", lease())).rejects.toMatchObject(
      { code: "invalid" },
    );
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await repository.rename("first", "Renamed", lease());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
