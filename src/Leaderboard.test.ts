import { getDocs } from "firebase/firestore";
import {
  invalidateLeaderboards,
  LEADERBOARD_FRESH_MS,
  loadLeaderboard,
} from "./Leaderboard";
jest.mock("./Globals", () => ({ getDb: () => ({}) }));
jest.mock("firebase/firestore", () => ({
  getDocs: jest.fn(),
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
