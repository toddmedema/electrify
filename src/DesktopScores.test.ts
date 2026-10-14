import { DesktopBridge, DesktopScore } from "./Desktop";
import { desktopGlobalRank, submitDesktopScore } from "./DesktopScores";

function bridge(entries: () => DesktopScore[]) {
  const desktop = {
    apiVersion: 1,
    submitScore: jest.fn().mockResolvedValue(undefined),
    getLeaderboard: jest.fn(async () => entries()),
  };
  window.electrifyDesktop = desktop as unknown as DesktopBridge;
  return desktop;
}
const entry = (score: number, rank = 7): DesktopScore => ({
  steamId: "76561198000000001",
  displayName: "Player",
  score,
  rank,
  scenarioId: 101,
  difficulty: "CEO",
});

afterEach(() => {
  delete window.electrifyDesktop;
  jest.useRealTimers();
});

it("waits for this run's submission before reading its Steam rank", async () => {
  let submitted = false;
  let finish = () => {};
  const desktop = bridge(() => (submitted ? [entry(812)] : [entry(500)]));
  desktop.submitScore.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          submitted = true;
          resolve();
        };
      }),
  );
  const submission = submitDesktopScore({
    scenarioId: 101,
    difficulty: "CEO",
    score: 812,
  });
  const rank = desktopGlobalRank(101, "CEO", 812);
  await Promise.resolve();
  expect(desktop.getLeaderboard).not.toHaveBeenCalled();
  finish();
  await submission;
  await expect(rank).resolves.toBe(7);
});

it("retries until a submission from elsewhere reaches Steam", async () => {
  jest.useFakeTimers();
  let reads = 0;
  bridge(() => (++reads < 3 ? [] : [entry(812, 3)]));
  const rank = desktopGlobalRank(101, "CEO", 812);
  for (let second = 0; second < 5; second++) {
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
    jest.advanceTimersByTime(1000);
  }
  await expect(rank).resolves.toBe(3);
});

it("reports no rank for a run that is not the player's Steam best", async () => {
  const desktop = bridge(() => [entry(900)]);
  await expect(desktopGlobalRank(101, "CEO", 812)).rejects.toThrow(
    "not your best",
  );
  expect(desktop.getLeaderboard).toHaveBeenCalledTimes(1);
});
