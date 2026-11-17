import { getCountFromServer, getDocs } from "firebase/firestore";
import {
  invalidateLeaderboards,
  loadLeaderboard,
  loadLeaderboardRank,
} from "./Leaderboard";
import { store } from "./Store";
import { victoryClose, victoryOpen } from "./reducers/GameActions";

jest.mock("firebase/firestore", () => ({
  ...jest.requireActual("firebase/firestore"),
  getDocs: jest.fn(),
  getCountFromServer: jest.fn(),
}));

beforeEach(() => {
  invalidateLeaderboards();
  jest.clearAllMocks();
  (getDocs as jest.Mock).mockResolvedValue({ docs: [] });
  (getCountFromServer as jest.Mock).mockResolvedValue({
    data: () => ({ count: 3 }),
  });
});

afterEach(() => store.dispatch(victoryClose()));

it.each(["completed", "bankrupt", "fired"] as const)(
  "refreshes boards and ranks before showing a %s result, even without an account or score write",
  async (outcome) => {
    expect(store.getState().user.uid).toBeUndefined();
    const read = () =>
      Promise.all([
        loadLeaderboard(101, "Intern"),
        loadLeaderboard(101, "Intern", "player", "previous-player"),
        loadLeaderboardRank(101, "Intern", 100),
      ]);
    await read();
    let resultReads: ReturnType<typeof read> | undefined;
    const unsubscribe = store.subscribe(() => {
      if (store.getState().ui.victory) resultReads = read();
    });
    try {
      store.dispatch(
        victoryOpen({
          scenarioId: 101,
          scenarioName: "Test mission",
          difficulty: "Intern",
          score: 100,
          breakdown: {},
          ranked: false,
          outcome,
        }),
      );
      await resultReads;
    } finally {
      unsubscribe();
    }
    expect(resultReads).toBeDefined();
    expect(getDocs).toHaveBeenCalledTimes(4);
    expect(getCountFromServer).toHaveBeenCalledTimes(2);
    await read();
    expect(getDocs).toHaveBeenCalledTimes(4);
    expect(getCountFromServer).toHaveBeenCalledTimes(2);
  },
);

it("keeps cached boards when closing a result", async () => {
  await loadLeaderboard(101, "Intern");
  store.dispatch(victoryClose());
  await loadLeaderboard(101, "Intern");
  expect(getDocs).toHaveBeenCalledTimes(1);
});
