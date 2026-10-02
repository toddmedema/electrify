import {
  ActiveSaveSession,
  resumeSavedGame,
  failSaveLoading,
  getLoadingGeneration,
  completeSaveLoading,
  runSaveTransition,
  quitSavedGame,
  exportCurrentSave,
  startSaveSessions,
  saveSessionMiddleware,
} from "./SaveSession";
import { downloadSave } from "./SaveFile";
import { store } from "./Store";
import { navigateBack } from "./reducers/Card";
import { quit } from "./reducers/GameActions";
import {
  dialogClose,
  dialogOpen,
  manualHelpClose,
  victoryClose,
} from "./reducers/UI";
import { CreateSaveOptions, SaveRepository } from "./SaveRepository";
import { SaveRepositoryError } from "./SaveModel";
import { createGame } from "./testing/Simulator";
import type {
  GameType,
  SaveMetadata,
  SaveRecord,
  SavedRunResult,
  SaveLease,
  SaveGameType,
} from "./Types";
import { serializeSave } from "./SaveGame";
import { currentRunSaveEffects, withRunSaveEffects } from "./SaveEffects";

jest.mock("./SaveFile", () => ({ downloadSave: jest.fn() }));
jest.mock("./SaveRepository", () => {
  const mockRepository = {
    prepareResume: jest.fn(),
    release: jest.fn().mockResolvedValue(undefined),
    markOpened: jest.fn(),
    renew: jest.fn(),
    writeSnapshot: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
    initialize: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockReturnValue(() => undefined),
  };
  return {
    SaveRepository: jest.fn().mockImplementation(() => mockRepository),
    mockRepository,
  };
});
jest.setTimeout(60000);

beforeEach(() => {
  const repository = require("./SaveRepository").mockRepository;
  repository.release.mockResolvedValue(undefined);
  repository.list.mockResolvedValue([]);
  repository.renew.mockResolvedValue(undefined);
  repository.initialize.mockResolvedValue(undefined);
  repository.subscribe.mockReturnValue(() => undefined);
  repository.writeSnapshot.mockResolvedValue({ ...metadata(3) });
  repository.markOpened.mockImplementation(async (lease: SaveLease) => ({
    ...lease,
    revision: lease.revision + 1,
  }));
});

let game: GameType;
beforeAll(() => {
  game = createGame({ scenarioId: 101, seed: 31337 });
});

function metadata(revision = 1): SaveMetadata {
  return {
    id: "A",
    name: "Experiment",
    createdAt: "2026-01-01T00:00:00.000Z",
    savedAt: "2026-01-01T00:00:00.000Z",
    revision,
    status: "inProgress",
    scenarioId: 101,
    scenarioName: "Scenario",
    locationName: game.location.name,
    difficulty: game.difficulty,
    date: { month: game.date.month, year: game.date.year },
  };
}
function record(): SaveRecord {
  return { metadata: metadata(), save: serializeSave(game) };
}
function fakeRepository() {
  const repository = {
    create: jest
      .fn<Promise<SaveRecord>, [CreateSaveOptions]>()
      .mockResolvedValue(record()),
    renew: jest.fn<Promise<void>, [SaveLease]>().mockResolvedValue(undefined),
    writeSnapshot: jest
      .fn<Promise<SaveMetadata>, [SaveLease, SaveGameType, string]>()
      .mockResolvedValue(metadata(2)),
    recordOutcome: jest
      .fn<
        Promise<SaveMetadata>,
        [SaveLease, SaveGameType, string, SavedRunResult]
      >()
      .mockResolvedValue(metadata(2)),
    release: jest.fn<Promise<void>, [SaveLease]>().mockResolvedValue(undefined),
  };
  return repository;
}
function session(
  repository: ReturnType<typeof fakeRepository>,
  existing?: SaveRecord,
) {
  const notify = jest.fn();
  return {
    writer: new ActiveSaveSession(
      repository as unknown as SaveRepository,
      "A",
      "Experiment",
      4,
      game,
      notify,
      existing,
      "writer-A",
    ),
    notify,
  };
}
function result(outcome: SavedRunResult["outcome"]): SavedRunResult {
  return {
    scenarioId: 101,
    scenarioName: "Scenario",
    difficulty: game.difficulty,
    score: 100,
    breakdown: {
      supply: 10,
      netWorth: 10,
      customers: 10,
      rate: 10,
      emissions: 10,
      blackouts: 10,
    },
    outcome,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("coalesces tick snapshots behind the one in-flight creation and keeps its save binding", async () => {
  const repository = fakeRepository();
  const creation = deferred<SaveRecord>();
  repository.create.mockReturnValueOnce(creation.promise);
  const { writer } = session(repository);
  const initial = writer.flush();
  writer.capture({ ...game, dollarsPerkWh: 0.1 });
  const second = writer.flush();
  const latest = { ...game, dollarsPerkWh: 0.12 };
  writer.capture(latest);
  const third = writer.flush();
  creation.resolve(record());
  await Promise.all([initial, second, third]);
  expect(repository.create).toHaveBeenCalledTimes(1);
  expect(repository.writeSnapshot).toHaveBeenCalledTimes(1);
  expect(repository.create.mock.calls[0][0]).toMatchObject({
    id: "A",
    writerToken: "writer-A",
  });
  expect(repository.writeSnapshot.mock.calls[0][0]).toEqual({
    saveId: "A",
    writerToken: "writer-A",
    revision: 2,
  });
  expect(repository.writeSnapshot.mock.calls[0][1].game.dollarsPerkWh).toBe(
    0.12,
  );
  expect(writer.saved).toBe(latest);
});

test("a failed first save retries the original ID with the latest terminal outcome", async () => {
  const repository = fakeRepository();
  const creation = deferred<SaveRecord>();
  repository.create.mockReturnValueOnce(creation.promise);
  const { writer, notify } = session(repository);
  const initial = writer.flush();
  const final = { ...game, speed: "PAUSED" as const };
  writer.outcome(final, result("fired"));
  creation.reject(new SaveRepositoryError("quota", "full"));
  await expect(initial).rejects.toThrow("full");
  expect(writer.created).toBe(false);
  expect(writer.mutationLease).toEqual({
    saveId: "A",
    writerToken: "writer-A",
    revision: 0,
  });
  expect(writer.file()).toMatchObject({
    status: "fired",
    result: { outcome: "fired" },
  });
  expect(notify).toHaveBeenLastCalledWith(
    "failed",
    undefined,
    expect.stringContaining("storage is full"),
  );
  await writer.flush();
  expect(writer.mutationLease).toBeUndefined();
  expect(repository.create).toHaveBeenCalledTimes(2);
  expect(repository.create.mock.calls[1][0]).toMatchObject({
    id: "A",
    status: "fired",
    result: { outcome: "fired" },
    save: { game: final },
  });
  expect(repository.release).not.toHaveBeenCalled();
});

test("completed results stay writable and a later terminal result replaces them", async () => {
  const repository = fakeRepository();
  const { writer } = session(repository, record());
  writer.outcome(game, result("completed"));
  await writer.flush();
  expect(repository.recordOutcome).toHaveBeenCalledTimes(1);
  expect(repository.release).not.toHaveBeenCalled();
  const continued = { ...game, dollarsPerkWh: 0.15 };
  writer.capture(continued);
  await writer.flush();
  expect(repository.writeSnapshot).toHaveBeenCalledTimes(1);
  expect(writer.file().result?.outcome).toBe("completed");
  writer.outcome(continued, result("bankrupt"));
  await writer.flush();
  expect(repository.recordOutcome).toHaveBeenCalledTimes(2);
  expect(repository.release).not.toHaveBeenCalled();
  expect(writer.mutationLease).toBeUndefined();
  writer.capture({ ...continued, dollarsPerkWh: 0.2 });
  expect(writer.latest).toBe(continued);
});

test("a fenced old writer retains an exportable snapshot and never recreates the record", async () => {
  const repository = fakeRepository();
  const { writer } = session(repository, record());
  repository.renew.mockRejectedValue(
    new SaveRepositoryError("conflict", "newer revision"),
  );
  const changed = { ...game, dollarsPerkWh: 0.17 };
  writer.capture(changed);
  await expect(writer.flush()).rejects.toThrow("newer revision");
  expect(repository.writeSnapshot).not.toHaveBeenCalled();
  expect(repository.create).not.toHaveBeenCalled();
  expect(writer.file().save.game).toBe(changed);
});

test("suspending a writer settles in-flight creation and cancels its queued snapshots", async () => {
  const repository = fakeRepository();
  const creation = deferred<SaveRecord>();
  repository.create.mockReturnValueOnce(creation.promise);
  const { writer } = session(repository);
  const initial = writer.flush();
  writer.capture({ ...game, dollarsPerkWh: 0.16 });
  writer.suspended = true;
  creation.resolve(record());
  await initial;
  await writer.settle();
  expect(writer.created).toBe(true);
  expect(repository.writeSnapshot).not.toHaveBeenCalled();
  await writer.flush();
  expect(repository.writeSnapshot).not.toHaveBeenCalled();
});

test("transient run effects restore the previous scope, including when reduction throws", () => {
  const outer = { outcome: jest.fn() },
    inner = { outcome: jest.fn() };
  expect(currentRunSaveEffects()).toBeUndefined();
  withRunSaveEffects(outer, () => {
    expect(() =>
      withRunSaveEffects(inner, () => {
        expect(currentRunSaveEffects()).toBe(inner);
        throw Error("reducer failure");
      }),
    ).toThrow("reducer failure");
    expect(currentRunSaveEffects()).toBe(outer);
  });
  expect(currentRunSaveEffects()).toBeUndefined();
});

test("failed resume loading releases the target and Back cannot expose abandoned gameplay", async () => {
  const repository = require("./SaveRepository").mockRepository;
  const target = record();
  repository.prepareResume.mockResolvedValue({
    record: target,
    lease: { saveId: "A", writerToken: "resume-A", revision: 1 },
  });
  store.dispatch(quit());
  expect(await resumeSavedGame("A")).toBe(true);
  expect(store.getState().card.name).toBe("LOADING");
  expect(store.getState().game.timeline.length).toBeGreaterThan(0);
  await failSaveLoading(
    getLoadingGeneration(),
    new Error("Weather download failed"),
  );
  expect(repository.release).toHaveBeenCalledWith({
    saveId: "A",
    writerToken: "resume-A",
    revision: 1,
  });
  expect(repository.markOpened).not.toHaveBeenCalled();
  expect(store.getState().card.name).toBe("SAVED_GAMES");
  expect(store.getState().game.timeline).toEqual([]);
  store.dispatch(navigateBack());
  expect(store.getState().card.name).toBe("MAIN_MENU");
  expect(store.getState().game.inGame).toBe(false);
});

test("capture during an awaited checkpoint settles the latest snapshot without a second flush call", async () => {
  const repository = fakeRepository();
  const checkpoint = deferred<SaveMetadata>();
  repository.writeSnapshot.mockReturnValueOnce(checkpoint.promise);
  const { writer } = session(repository, record());
  writer.capture({ ...game, dollarsPerkWh: 0.1 });
  const finalFlush = writer.flush();
  const latest = { ...game, dollarsPerkWh: 0.18 };
  writer.capture(latest);
  checkpoint.resolve(metadata(2));
  await finalFlush;
  expect(repository.writeSnapshot).toHaveBeenCalledTimes(2);
  expect(writer.saved).toBe(latest);
  expect(repository.writeSnapshot.mock.calls[1][1].game.dollarsPerkWh).toBe(
    0.18,
  );
});

test("an old rejected Resume cannot replace a newer accepted loading request with an error", async () => {
  const repository = require("./SaveRepository").mockRepository;
  const older = deferred<unknown>();
  const target = record();
  repository.prepareResume
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce({
      record: target,
      lease: { saveId: "A", writerToken: "newer", revision: 1 },
    });
  store.dispatch(quit());
  store.dispatch(dialogClose());
  const oldRequest = resumeSavedGame("old-A");
  expect(await resumeSavedGame("new-B")).toBe(true);
  const currentGeneration = getLoadingGeneration();
  older.reject(new SaveRepositoryError("missing", "Old save disappeared"));
  expect(await oldRequest).toBe(false);
  expect(store.getState().card.name).toBe("LOADING");
  expect(store.getState().ui.dialog.open).toBe(false);
  expect(getLoadingGeneration()).toBe(currentGeneration);
  await failSaveLoading(currentGeneration);
});

test("a failed source lease release retains the live game and offers transition recovery", async () => {
  const repository = require("./SaveRepository").mockRepository;
  const target = record();
  repository.prepareResume.mockResolvedValue({
    record: target,
    lease: { saveId: "A", writerToken: "release-A", revision: 1 },
  });
  store.dispatch(quit());
  store.dispatch(dialogClose());
  expect(await resumeSavedGame("A")).toBe(true);
  expect(await completeSaveLoading(getLoadingGeneration())).toBe(true);
  repository.release.mockRejectedValueOnce(
    new SaveRepositoryError("unavailable", "release unavailable"),
  );
  const proceed = jest.fn();
  expect(await runSaveTransition(proceed)).toBe(false);
  expect(proceed).not.toHaveBeenCalled();
  expect(store.getState().saves.activeId).toBe("A");
  expect(store.getState().game.timeline.length).toBeGreaterThan(0);
  expect(store.getState().ui.dialog.title).toBe("Your game could not be saved");
  expect(store.getState().ui.dialog.actionLabel).toBe("Retry");
  expect(await quitSavedGame()).toBe(true);
});

async function openActive() {
  const repository = require("./SaveRepository").mockRepository;
  await quitSavedGame();
  store.dispatch(dialogClose());
  repository.prepareResume.mockResolvedValue({
    record: record(),
    lease: { saveId: "A", writerToken: "handoff-A", revision: 1 },
  });
  expect(await resumeSavedGame("A")).toBe(true);
  expect(await completeSaveLoading(getLoadingGeneration())).toBe(true);
  return repository;
}
async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 30 && !predicate(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  expect(predicate()).toBe(true);
}

test("handoff fences decisions and checkpoints while release waits, and only the newest accepted intent proceeds", async () => {
  const repository = await openActive();
  store.dispatch(
    dialogOpen({ title: "Existing dialog", message: "", open: true }),
  );
  const release = deferred<void>();
  const entered = jest.fn();
  repository.release.mockImplementationOnce(() => {
    entered();
    return release.promise;
  });
  const older = jest.fn(),
    newer = jest.fn();
  const first = runSaveTransition(older);
  await eventually(() => !!entered.mock.calls.length);
  const savedGame = store.getState().game;
  const writes = repository.writeSnapshot.mock.calls.length;
  store.dispatch({ type: "game/delta", payload: { dollarsPerkWh: 0.99 } });
  expect(store.getState().game).toBe(savedGame);
  store.dispatch(dialogClose());
  store.dispatch(victoryClose());
  store.dispatch(manualHelpClose());
  expect(store.getState().game).toBe(savedGame);
  expect(store.getState().ui.dialog.open).toBe(true);
  const next = jest.fn();
  saveSessionMiddleware(store)(next)({ type: "game/tick" });
  expect(next).toHaveBeenCalledWith({ type: "game/tick" });
  const second = runSaveTransition(newer);
  expect(store.getState().saves.transitioning).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(newer).not.toHaveBeenCalled();
  release.resolve();
  expect(await first).toBe(false);
  expect(await second).toBe(true);
  expect(older).not.toHaveBeenCalled();
  expect(newer).toHaveBeenCalledTimes(1);
  expect(repository.writeSnapshot).toHaveBeenCalledTimes(writes);
  expect(store.getState().saves.transitioning).toBe(false);
  expect(store.getState().saves.activeId).toBeUndefined();
});

test("an intent superseded during prepared-target release never proceeds", async () => {
  const repository = require("./SaveRepository").mockRepository;
  repository.prepareResume.mockResolvedValue({
    record: record(),
    lease: { saveId: "A", writerToken: "prepared-A", revision: 1 },
  });
  expect(await resumeSavedGame("A")).toBe(true);
  const release = deferred<void>(),
    entered = jest.fn();
  repository.release.mockImplementationOnce(() => {
    entered();
    return release.promise;
  });
  const older = jest.fn(),
    newer = jest.fn();
  const first = runSaveTransition(older);
  await eventually(() => !!entered.mock.calls.length);
  const second = runSaveTransition(newer);
  release.resolve();
  expect(await first).toBe(false);
  expect(await second).toBe(true);
  expect(older).not.toHaveBeenCalled();
  expect(newer).toHaveBeenCalledTimes(1);
});

test("export remains bound to the requested session when a concurrent transition clears active", async () => {
  await openActive();
  const exporting = deferred<void>();
  const flush = jest
    .spyOn(ActiveSaveSession.prototype, "flush")
    .mockImplementationOnce(() => exporting.promise);
  const exported = exportCurrentSave();
  expect(await quitSavedGame()).toBe(true);
  exporting.resolve();
  await exported;
  expect(downloadSave).toHaveBeenLastCalledWith(
    expect.objectContaining({
      name: "Experiment",
      save: expect.objectContaining({
        game: expect.objectContaining({ scenarioId: 101 }),
      }),
    }),
  );
  flush.mockRestore();
});

test("teardown releases token locks even when IndexedDB release fails, allowing remount", async () => {
  await quitSavedGame();
  const originalLocks = navigator.locks;
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void>,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({ name, mode: "exclusive" } as Lock);
        } finally {
          held.delete(name);
        }
      },
    },
  });
  const repository = require("./SaveRepository").mockRepository;
  repository.prepareResume.mockImplementation(
    async (_id: string, writerToken: string) => ({
      record: record(),
      lease: { saveId: "A", writerToken, revision: 1 },
    }),
  );
  let cleanup = startSaveSessions(store);
  try {
    expect(await resumeSavedGame("A")).toBe(true);
    expect(await completeSaveLoading(getLoadingGeneration())).toBe(true);
    expect(held.size).toBe(1);
    repository.release.mockRejectedValueOnce(new Error("storage disappeared"));
    cleanup();
    await eventually(() => held.size === 0);
    expect(store.getState().saves.activeId).toBeUndefined();
    cleanup = startSaveSessions(store);
    expect(await resumeSavedGame("A")).toBe(true);
    expect(await completeSaveLoading(getLoadingGeneration())).toBe(true);
    expect(held.size).toBe(1);
  } finally {
    cleanup();
    await eventually(() => held.size === 0);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: originalLocks,
    });
  }
});
