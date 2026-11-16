import { getCountFromServer, getDocs } from "firebase/firestore";
import {
  invalidateLeaderboards,
  LEADERBOARD_FRESH_MS,
  loadLeaderboard,
  loadLeaderboardRank,
} from "./Leaderboard";
jest.mock("./Globals", () => ({ getDb: () => ({}) }));
jest.mock("firebase/firestore", () => ({
  getDocs: jest.fn(),
  getCountFromServer: jest.fn(),
  collection: () => "scores",
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
}));
beforeEach(() => {
  invalidateLeaderboards();
  jest.clearAllMocks();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
it("shares in-flight and successful empty boards across consumers until their explicit TTL", async () => {
  let resolve!: (value: { docs: never[] }) => void;
  (getDocs as jest.Mock)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValue({ docs: [] });
  const scenario = loadLeaderboard(101, "CEO");
  const results = loadLeaderboard(101, "CEO");
  expect(getDocs).toHaveBeenCalledTimes(1);
  resolve({ docs: [] });
  expect(await scenario).toEqual([]);
  expect(await results).toEqual([]);
  await loadLeaderboard(101, "CEO");
  expect(getDocs).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(LEADERBOARD_FRESH_MS + 1);
  await loadLeaderboard(101, "CEO");
  expect(getDocs).toHaveBeenCalledTimes(2);
});
it("isolates accounts/difficulties, retries failures and never resurrects invalidated in-flight results", async () => {
  (getDocs as jest.Mock)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ docs: [] });
  await expect(loadLeaderboard(101, "CEO", "player", "alice")).rejects.toThrow(
    "offline",
  );
  await loadLeaderboard(101, "CEO", "player", "alice");
  await loadLeaderboard(101, "CEO", "player", "bob");
  await loadLeaderboard(101, "Intern", "player", "alice");
  expect(getDocs).toHaveBeenCalledTimes(4);
  let finish!: (value: unknown) => void;
  (getDocs as jest.Mock).mockReturnValueOnce(
    new Promise((done) => {
      finish = done;
    }),
  );
  const stale = loadLeaderboard(110, "CEO");
  invalidateLeaderboards();
  await loadLeaderboard(110, "CEO");
  finish({ docs: [{ data: () => ({ score: 999 }) }] });
  await stale;
  expect(await loadLeaderboard(110, "CEO")).toEqual([]);
  expect(getDocs).toHaveBeenCalledTimes(6);
});

it.each([
  { name: "empty", docs: [] },
  { name: "populated", docs: [{ data: () => ({ score: 999 }) }] },
])(
  "reuses $name rows and ranks for ten visits a minute apart, then expires at ten minutes",
  async ({ docs }) => {
    (getDocs as jest.Mock).mockResolvedValue({ docs });
    (getCountFromServer as jest.Mock).mockResolvedValue({
      data: () => ({ count: 3 }),
    });
    for (let visit = 0; visit < 10; visit++) {
      expect(await loadLeaderboard(101, "CEO")).toEqual(
        docs.map((doc) => doc.data()),
      );
      expect(await loadLeaderboardRank(101, "CEO", 100)).toBe(4);
      jest.advanceTimersByTime(60_000);
    }
    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(getCountFromServer).toHaveBeenCalledTimes(1);
    await loadLeaderboard(101, "CEO");
    await loadLeaderboardRank(101, "CEO", 100);
    expect(getDocs).toHaveBeenCalledTimes(2);
    expect(getCountFromServer).toHaveBeenCalledTimes(2);
  },
);
