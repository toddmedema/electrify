import { DesktopBridge, DesktopScore } from "./Desktop";
import {
  desktopGlobalRank,
  desktopScoreRank,
  submitDesktopScore,
} from "./DesktopScores";

jest.mock("./AppVersion", () => ({ APP_VERSION: "26sept26-1507" }));

function bridge(entries: () => DesktopScore[]) {
  const desktop = {
    apiVersion: 1,
    submitScore: jest.fn().mockResolvedValue(undefined),
    getLeaderboard: jest.fn<
      Promise<DesktopScore[]>,
      [Parameters<DesktopBridge["getLeaderboard"]>[0]]
    >(async () => entries()),
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
    outcome: "completed",
    scenarioId: 101,
    difficulty: "CEO",
    score: 812,
  });
  const rank = desktopGlobalRank(101, "CEO", 812);
  await Promise.resolve();
  expect(desktop.getLeaderboard).not.toHaveBeenCalled();
  finish();
  await submission;
  expect(desktop.submitScore).toHaveBeenCalledWith(
    expect.objectContaining({
      appVersion: "26sept26-1507",
    }),
  );
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

it.each(["bankrupt", "fired"] as const)(
  "never sends a %s score to Steam",
  async (outcome) => {
    const desktop = bridge(() => []);
    await submitDesktopScore({
      scenarioId: 101,
      difficulty: "CEO",
      score: 9999,
      outcome,
    });
    expect(desktop.submitScore).not.toHaveBeenCalled();
  },
);

it("uses the completed run's actual Steam rank when it is a personal best", async () => {
  const desktop = bridge(() => [entry(540, 47)]);
  await expect(desktopScoreRank(101, "CEO", 540)).resolves.toBe(47);
  expect(desktop.getLeaderboard).toHaveBeenCalledTimes(1);
});

it.each([1, 47, 147, 201])(
  "places a lower run at rank %s beyond Steam's initial page",
  async (rank) => {
    const desktop = bridge(() => [entry(999)]);
    desktop.getLeaderboard.mockImplementation(async (...args: unknown[]) => {
      const request = args[0] as Parameters<DesktopBridge["getLeaderboard"]>[0];
      if (request.scope === "player") return [entry(999)];
      const position = request.startRank!;
      return position > 200
        ? []
        : [entry(position < rank ? 900 : 540, position)];
    });
    await expect(desktopScoreRank(101, "CEO", 540)).resolves.toBe(rank);
    expect(
      desktop.getLeaderboard.mock.calls.every((call) => {
        const selection = (call as unknown[])[0] as Parameters<
          DesktopBridge["getLeaderboard"]
        >[0];
        return selection.scenarioId === 101 && selection.difficulty === "CEO";
      }),
    ).toBe(true);
  },
);
