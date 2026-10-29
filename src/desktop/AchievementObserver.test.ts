import { startAchievements } from "./AchievementObserver";
import type { RootState } from "../Store";
import type { DesktopBridge } from "../Desktop";

function fixture() {
  const state = {
    game: { desktopAchievements: { earned: [] } },
    saves: { transitioning: false },
  } as unknown as RootState;
  let listener = () => {};
  const submit = jest.fn().mockResolvedValue(undefined);
  const unsubscribe = jest.fn();
  const store = {
    getState: () => state,
    subscribe: (callback: () => void) => {
      listener = callback;
      return unsubscribe;
    },
  };
  const stop = startAchievements(store, {
    submitAchievements: submit,
  } as unknown as DesktopBridge);
  return { state, submit, stop, unsubscribe, notify: () => listener() };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("sends committed awards immediately, deduplicates repeated snapshots, and captures later completions", () => {
  const f = fixture();
  f.state.game.desktopAchievements!.earned = ["LIGHTS_ON"];
  f.notify();
  expect(f.submit).toHaveBeenCalledWith({
    earned: ["LIGHTS_ON"],
    completion: undefined,
  });
  f.notify();
  jest.advanceTimersByTime(10000);
  expect(f.submit).toHaveBeenCalledTimes(1);
  f.state.game.desktopAchievements!.completion = {
    scenarioId: 101,
    difficulty: "CEO",
  };
  f.notify();
  expect(f.submit).toHaveBeenCalledTimes(2);
  expect(f.submit.mock.calls[0][0].completion).toBeUndefined();
  f.stop();
  expect(f.unsubscribe).toHaveBeenCalled();
});
test("failed disk IPC retries the same intent and stopped observers release their retry timer", async () => {
  const f = fixture();
  f.submit.mockRejectedValueOnce(new Error("disk unavailable"));
  f.state.game.desktopAchievements!.earned = ["LIGHTS_ON"];
  f.notify();
  await Promise.resolve();
  jest.advanceTimersByTime(5000);
  expect(f.submit).toHaveBeenCalledTimes(2);
  f.stop();
  f.state.game.desktopAchievements!.earned.push("GOOD_NEIGHBOR");
  f.notify();
  jest.advanceTimersByTime(10000);
  expect(f.submit).toHaveBeenCalledTimes(2);
});
test("restored intent is retried once, while custom and transitioning state never submits", () => {
  const f = fixture();
  f.state.game.desktopAchievements!.earned = ["LIGHTS_ON"];
  f.state.saves.transitioning = true;
  f.notify();
  f.state.saves.transitioning = false;
  f.state.game.customScenario = {} as RootState["game"]["customScenario"];
  f.notify();
  expect(f.submit).not.toHaveBeenCalled();
  f.state.game.customScenario = undefined;
  f.notify();
  f.notify();
  expect(f.submit).toHaveBeenCalledTimes(1);
  f.stop();
});
