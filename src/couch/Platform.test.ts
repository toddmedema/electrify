import cloneDeep from "lodash.clonedeep";
import { store, RootState } from "../Store";
import { createGame } from "../testing/Simulator";
import {
  initializeAchievements,
  startAchievementServices,
} from "../achievements/Runtime";
import { AchievementJournal } from "../achievements/Journal";
import { startAchievements } from "../desktop/AchievementObserver";
import { startDesktopActivity } from "../DesktopActivity";
import type { DesktopBridge } from "../Desktop";
import type { RoomView } from "../multiplayer/Types";
import type { GameType } from "../Types";
import {
  beginCouchPlatform,
  couchPlatformActive,
  withCouchPlatform,
} from "./Platform";

const sessions: ReturnType<typeof beginCouchPlatform>[] = [];
const begin = () => {
  const session = beginCouchPlatform();
  sessions.push(session);
  return session;
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const view = (game: GameType, revision = 1): RoomView => ({
  game,
  revision,
  matchId: "local-match",
  epoch: "epoch",
  speed: "NORMAL",
  readyRequired: false,
  disconnected: [],
  lastSequence: 0,
  reason: "",
  ready: [],
  grids: [],
});
function fixture() {
  let state: RootState = {
    ...store.getState(),
    game: cloneDeep(createGame({ scenarioId: 101 })),
    settings: { ...store.getState().settings, steamTimelineEnabled: true },
    card: { ...store.getState().card, name: "MAIN_MENU" },
  };
  state.game.inGame = false;
  const listeners = new Set<() => void>();
  const source = {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    state: () => state,
    update: () => {
      state = { ...state };
      listeners.forEach((listener) => listener());
    },
  };
}
beforeAll(initializeAchievements);
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  sessions.forEach((session) => session.dispose());
  sessions.length = 0;
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("one account observer accepts P1, rejects guest evidence, and resumes without replaying history", async () => {
  const f = fixture();
  const account = withCouchPlatform(f.source);
  const submit = jest.fn().mockResolvedValue(undefined);
  const timeline = jest.fn().mockResolvedValue(undefined);
  const activity = jest.fn().mockResolvedValue(undefined);
  const desktop = {
    submitAchievements: submit,
    setActivity: activity,
    addTimelineEvent: timeline,
    onStateChanged: () => () => {},
  } as unknown as DesktopBridge;
  const values = new Map<string, string>();
  const journal = new AchievementJournal(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  }));
  const stopNative = startAchievements(account, desktop);
  const stopJournal = startAchievementServices(account, journal, undefined);
  const stopActivity = startDesktopActivity(account, desktop);
  const session = begin();
  const p1 = cloneDeep(createGame({ scenarioId: 101 }));
  p1.multiplayer = { seat: "local-p1" };
  p1.inGame = true;
  p1.speed = "NORMAL";
  p1.desktopAchievements!.earned = ["LIGHTS_ON"];
  p1.eventLog = [
    {
      id: 1,
      kind: "CONSTRUCTION",
      label: "Jan",
      message: "Saved construction",
    },
  ];
  const guest = cloneDeep(p1);
  guest.multiplayer = { seat: "local-p2" };
  guest.desktopAchievements!.earned = ["OUT_OF_JUICE"];
  expect(session.publish(view(guest))).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  expect(session.publish(view(p1))).toBe(true);
  await flush();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenLastCalledWith({
    earned: ["LIGHTS_ON"],
    completion: undefined,
  });
  expect(journal.getSnapshot().notifications).toEqual([]);
  expect(timeline).not.toHaveBeenCalled();
  expect(activity).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "playing", scenarioId: 101 }),
  );
  const next = cloneDeep(p1);
  next.desktopAchievements!.earned.push("OUT_OF_JUICE");
  next.eventLog.unshift({
    id: 2,
    kind: "CONSTRUCTION",
    label: "Feb",
    message: "New construction",
  });
  session.publish(view(next, 2));
  await flush();
  expect(submit).toHaveBeenCalledTimes(2);
  expect(journal.getSnapshot().notifications).toEqual(["OUT_OF_JUICE"]);
  expect(timeline).toHaveBeenCalledTimes(1);
  f.update();
  await flush();
  expect(submit).toHaveBeenCalledTimes(2);
  expect(timeline).toHaveBeenCalledTimes(1);
  expect(f.state().game.multiplayer).toBeUndefined();
  expect(f.state().game.inGame).toBe(false);
  stopNative();
  stopJournal();
  stopActivity();
});

test("obsolete owners cannot publish or end a newer session, and disposed projections release subscriptions", () => {
  const f = fixture();
  const account = withCouchPlatform(f.source);
  const notify = jest.fn();
  const stop = account.subscribe(notify);
  const old = begin();
  const current = begin();
  const game = cloneDeep(createGame({ scenarioId: 101 }));
  game.multiplayer = { seat: "local-p1" };
  expect(old.publish(view(game))).toBe(false);
  old.dispose();
  expect(couchPlatformActive()).toBe(true);
  expect(current.publish(view(game, 3))).toBe(true);
  expect(current.publish(view(game, 2))).toBe(false);
  expect(account.getState().game).toBe(game);
  current.dispose();
  expect(account.getState()).toBe(f.state());
  stop();
  const calls = notify.mock.calls.length;
  f.update();
  begin();
  expect(notify).toHaveBeenCalledTimes(calls);
});
