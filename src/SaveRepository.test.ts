import "fake-indexeddb/auto";
import { deserialize, serialize } from "v8";
import { SaveRepository } from "./SaveRepository";
import { parseSave, serializeSave } from "./SaveGame";
import { fakeSaveGame, fakeSavedResult } from "./testing/SaveTestHelpers";
import type { SaveLease, VictoryType } from "./Types";
import { SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { createGame } from "./testing/Simulator";
import { runMonths } from "./testing/SimulationTestHelpers";
import reducer, { buildTransmissionLine, tickState } from "./reducers/Game";
import { acquireUtility } from "./reducers/GameActions";
import { acquisitionQuote } from "./helpers/Expansion";
import { copyOfficialGame } from "./testing/OfficialScenarioExecutionFixtures";
import { savedRunResult, parseSavedRunResult } from "./SaveModel";

// v8 creates Node-realm objects. Re-home containers in jsdom without JSON, retaining
// own undefined properties and non-finite values for the strict parser to inspect.
function currentRealm(value: unknown): unknown {
  if (Array.isArray(value)) return Array.from(value, currentRealm);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, currentRealm(child)]),
    );
  return value;
}

// jsdom omits Node's native structuredClone; IndexedDB still needs a real structured clone.
if (typeof structuredClone === "undefined") {
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: <T>(value: T): T => currentRealm(deserialize(serialize(value))) as T,
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

  it("persists and reopens a raw first-year rollover with inactive battery meters", async () => {
    const game = createGame({
      scenarioId: 116,
      difficulty: "Employee",
      seed: 3857637116,
    });
    for (const tick of game.timeline) {
      tick.customerBatteryWh = undefined;
      tick.customerBatteryWhStart = undefined;
      tick.customerBatteryLossWh = undefined;
    }
    await repository.create({
      id: "first",
      name: "Valley",
      save: serializeSave(game),
      scenarioName: "Across the Valley",
      writerToken: "tab-one",
    });
    runMonths(game, 12);
    const written = await repository.writeSnapshot(
      lease(),
      serializeSave(game),
      "Across the Valley",
    );
    await repository.release(lease("first", written.revision));
    repository.close();
    const restored = await other.read("first");
    expect(restored.save.game.date.monthsElapsed).toBe(12);
    expect(restored.save.game.monthlyHistory).toHaveLength(12);
    expect(
      restored.save.game.monthlyHistory[0].chartAverage,
    ).not.toHaveProperty("customerBatteryWh");
    expect(restored.save.game.monthlyHistory[0].chartAverage?.cash).toBe(
      game.monthlyHistory[0].chartAverage?.cash,
    );
  });

  it("persists the natural terminal result after an acquisition before its deadline", async () => {
    let game = createGame({
      scenarioId: 116,
      difficulty: "Employee",
      seed: 12345,
      storyEffectsEnabled: true,
      weatherHazardsEnabled: true,
    });
    await repository.create({
      id: "first",
      name: "Valley",
      save: serializeSave(game),
      scenarioName: "Across the Valley",
      writerToken: "tab-one",
    });
    let terminal: VictoryType | undefined;
    jest.useFakeTimers();
    try {
      game = copyOfficialGame(
        reducer(
          game,
          buildTransmissionLine({
            corridorId: "vt-champlain-valley",
            financed: false,
          }),
        ),
      );
      while (game.date.monthsElapsed < 25) tickState(game);
      const quote = acquisitionQuote(game, "valley-electric")!;
      expect(quote).toBeDefined();
      game = copyOfficialGame(
        reducer(
          game,
          acquireUtility({
            targetId: "valley-electric",
            financed: true,
            quoteKey: quote.quoteKey,
          }),
        ),
      );
      const effects = {
        outcome: (victory: VictoryType, message?: () => string) => {
          terminal = {
            ...victory,
            endMessage: message?.() || victory.endMessage,
          };
        },
      };
      while (!terminal && game.date.monthsElapsed < 120)
        tickState(game, effects);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    expect(terminal?.outcome).toBe("fired");
    expect(game.date.monthsElapsed).toBeLessThan(120);
    const ownership = terminal!.debrief!.objectiveResults!.find(
      (result) => result.metric === "utilityOwnership",
    )!;
    expect(ownership.status).toBe("completed");
    const result = savedRunResult(terminal!);
    expect(ownership).not.toHaveProperty("reason");
    // Invalid untrusted neighbors still fail; the producer must emit canonical data.
    expect(
      parseSavedRunResult({
        ...result,
        debrief: {
          ...result.debrief,
          objectiveResults: [{ ...ownership, reason: undefined }],
        },
      }),
    ).toBeNull();
    const ended = await repository.recordOutcome(
      lease(),
      serializeSave(game),
      "Across the Valley",
      result,
    );
    expect(ended.status).toBe("fired");
    repository.close();
    const reopened = await other.read("first");
    expect(reopened.metadata.status).toBe("fired");
    expect(reopened.result).toEqual(result);
    expect(reopened.save.game.date.monthsElapsed).toBe(game.date.monthsElapsed);
  }, 30000);

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
