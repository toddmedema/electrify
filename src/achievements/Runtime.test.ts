import cloneDeep from "lodash.clonedeep";
import { store, RootState } from "../Store";
import { createGame } from "../testing/Simulator";
import { AchievementJournal } from "./Journal";
import {
  initializeAchievements,
  startAchievementServices,
  retryAchievementSync,
} from "./Runtime";
import { emptyRecord, mergeRecords, recordIntent } from "./Progress";
import type { AchievementTransport } from "./FirebaseTransport";
import type { GameType } from "../Types";

function fixture(uid?: string) {
  let state: RootState = {
    ...store.getState(),
    game: cloneDeep(createGame({ scenarioId: 101 })),
    user: { uid },
  };
  state.game.inGame = false;
  const listeners = new Set<() => void>();
  const observer = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const publish = (game: Partial<GameType> = {}, nextUid = state.user.uid) => {
    state = {
      ...state,
      game: { ...state.game, ...game },
      user: { uid: nextUid },
    };
    listeners.forEach((listener) => listener());
  };
  const values = new Map<string, string>();
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  const journal = new AchievementJournal(storage);
  return { observer, publish, journal, storage, game: () => state.game };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeAll(initializeAchievements);
beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("live awards toast once while loaded and custom evidence never count", () => {
  const f = fixture();
  const stop = startAchievementServices(f.observer, f.journal);
  f.publish({ inGame: true });
  const progress = f.game().desktopAchievements!;
  f.publish({ desktopAchievements: { ...progress, earned: ["OUT_OF_JUICE"] } });
  f.publish();
  expect(f.journal.getSnapshot().notifications).toEqual(["OUT_OF_JUICE"]);
  f.journal.clearNotifications();
  // A resumed save or shared link carries someone's earlier evidence, including a finished run.
  f.publish({
    inGame: false,
    desktopAchievements: {
      ...progress,
      earned: ["FIRST_SPARK", "LIGHTS_ON"],
      completion: { scenarioId: 101, difficulty: "CEO" },
    },
  });
  f.publish({ inGame: true });
  expect(f.journal.getSnapshot().progress.earned).toEqual(["OUT_OF_JUICE"]);
  // Play continuing from that save still earns what happens live.
  f.publish({
    desktopAchievements: {
      ...f.game().desktopAchievements!,
      earned: ["FIRST_SPARK", "LIGHTS_ON", "FOUR_NINES"],
    },
  });
  expect(f.journal.getSnapshot().progress.earned).toEqual([
    "FOUR_NINES",
    "OUT_OF_JUICE",
  ]);
  expect(f.journal.getSnapshot().notifications).toEqual(["FOUR_NINES"]);
  stop();
});

test("a guest award claimed by another tab is not announced or re-offered to the guest", () => {
  const f = fixture();
  const stop = startAchievementServices(f.observer, f.journal);
  f.publish({ inGame: true });
  const progress = f.game().desktopAchievements!;
  f.publish({ desktopAchievements: { ...progress, earned: ["LIGHTS_ON"] } });
  expect(f.journal.getSnapshot().notifications).toEqual(["LIGHTS_ON"]);
  f.journal.clearNotifications();
  new AchievementJournal(f.storage).activate("alice");
  f.journal.refresh();
  expect(f.journal.getSnapshot().progress.earned).toEqual([]);
  f.publish({
    desktopAchievements: { ...progress, earned: ["LIGHTS_ON", "FOUR_NINES"] },
  });
  expect(f.journal.getSnapshot().notifications).toEqual(["FOUR_NINES"]);
  expect(f.journal.getSnapshot().progress.earned).toEqual(["FOUR_NINES"]);
  stop();
});

test("guest progress uploads on login, cloud awards download silently and offline writes retry", async () => {
  const f = fixture();
  f.journal.merge(recordIntent({ earned: ["FIRST_SPARK"] }));
  let remote = recordIntent({ earned: ["LIGHTS_ON"] });
  const merge = jest.fn<
    ReturnType<AchievementTransport["merge"]>,
    Parameters<AchievementTransport["merge"]>
  >(async (_uid, local) => {
    remote = mergeRecords(remote, local);
    return remote;
  });
  const stop = startAchievementServices(f.observer, f.journal, { merge });
  f.publish({}, "alice");
  await flush();
  expect(merge).toHaveBeenCalledWith(
    "alice",
    expect.objectContaining({ earned: ["FIRST_SPARK"] }),
    expect.any(Function),
  );
  expect(f.journal.getSnapshot().progress.earned).toEqual([
    "FIRST_SPARK",
    "LIGHTS_ON",
  ]);
  expect(f.journal.getSnapshot().notifications).toEqual([]);
  expect(f.journal.getSnapshot().sync).toBe("synced");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  f.publish({ inGame: true });
  f.publish({
    desktopAchievements: {
      ...f.game().desktopAchievements!,
      earned: ["OUT_OF_JUICE"],
    },
  });
  expect(f.journal.getSnapshot().sync).toBe("offline");
  expect(remote.earned).not.toContain("OUT_OF_JUICE");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  window.dispatchEvent(new Event("online"));
  await flush();
  expect(remote.earned).toContain("OUT_OF_JUICE");
  expect(f.journal.getSnapshot().sync).toBe("synced");
  stop();
});

test("a late cloud response and the prior account's active run cannot leak into another account", async () => {
  const f = fixture("alice");
  let resolve!: (record: ReturnType<typeof emptyRecord>) => void;
  const first = new Promise<ReturnType<typeof emptyRecord>>((done) => {
    resolve = done;
  });
  const merge = jest
    .fn<
      ReturnType<AchievementTransport["merge"]>,
      Parameters<AchievementTransport["merge"]>
    >()
    .mockImplementationOnce(() => first)
    .mockImplementation(async (_uid, local) => local);
  const stop = startAchievementServices(f.observer, f.journal, { merge });
  f.publish({
    inGame: true,
    desktopAchievements: {
      ...f.game().desktopAchievements!,
      earned: ["LIGHTS_ON"],
    },
  });
  f.publish({}, "bob");
  resolve(recordIntent({ earned: ["FIRST_SPARK", "LIGHTS_ON"] }));
  await flush();
  expect(f.journal.getSnapshot().uid).toBe("bob");
  expect(f.journal.getSnapshot().progress).toEqual(emptyRecord());
  f.publish({
    desktopAchievements: {
      ...f.game().desktopAchievements!,
      earned: ["LIGHTS_ON", "OUT_OF_JUICE"],
    },
  });
  await flush();
  expect(f.journal.getSnapshot().progress.earned).toEqual(["OUT_OF_JUICE"]);
  expect(f.journal.getSnapshot().notifications).toEqual(["OUT_OF_JUICE"]);
  stop();
});

test("awards earned during an upload drain afterward; a failed upload offers a retry", async () => {
  const f = fixture("alice");
  let resolve!: (record: ReturnType<typeof emptyRecord>) => void;
  const first = new Promise<ReturnType<typeof emptyRecord>>((done) => {
    resolve = done;
  });
  const merge = jest
    .fn<
      ReturnType<AchievementTransport["merge"]>,
      Parameters<AchievementTransport["merge"]>
    >()
    .mockImplementationOnce(() => first)
    .mockImplementationOnce(async () => {
      throw new Error("Network failed");
    })
    .mockImplementation(async (_uid, local) => local);
  const stop = startAchievementServices(f.observer, f.journal, { merge });
  f.publish({ inGame: true });
  f.publish({
    desktopAchievements: {
      ...f.game().desktopAchievements!,
      earned: ["OUT_OF_JUICE"],
    },
  });
  resolve(emptyRecord());
  await flush();
  expect(merge).toHaveBeenCalledTimes(2);
  expect(f.journal.getSnapshot().sync).toBe("failed");
  retryAchievementSync();
  await flush();
  expect(merge).toHaveBeenCalledTimes(3);
  expect(f.journal.getSnapshot().progress.earned).toEqual(["OUT_OF_JUICE"]);
  expect(f.journal.getSnapshot().sync).toBe("synced");
  stop();
});
