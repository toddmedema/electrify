import { configureStore } from "@reduxjs/toolkit";
import userReducer, {
  saveDisplayName,
  fetchGlobalRank,
  loadProfile,
  logout,
  submitHighscore,
} from "./User";
import { MAX_REPLAY_BYTES, REPLAY_VERSION } from "../Replay";
import { LOCATIONS } from "../Constants";
import { ReplayType, UserType } from "../Types";

const mockAddDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockSetDoc = jest.fn();
const mockGetCount = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn();
const mockSignOut = jest.fn();

jest.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, name: string, id: string) => ({ path: `${name}/${id}` }),
  getCountFromServer: (...args: unknown[]) => mockGetCount(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  limit: (n: number) => ({ limit: n }),
  orderBy: (field: string) => ({ orderBy: field }),
  query: (...parts: unknown[]) => ({ parts }),
  serverTimestamp: () => "SERVER_TIMESTAMP",
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  writeBatch: () => ({ update: mockBatchUpdate, commit: mockBatchCommit }),
}));

jest.mock("../Globals", () => ({
  getDb: () => ({}),
  logout: () => mockSignOut(),
}));

const SIGNED_IN: UserType = { uid: "player-1" };

function makeStore(user: UserType = {}) {
  return configureStore({
    reducer: { user: userReducer },
    preloadedState: { user },
  });
}

function aReplay(overrides: Partial<ReplayType> = {}): ReplayType {
  return {
    version: REPLAY_VERSION,
    appVersion: "0.1.0",
    scenarioId: 101,
    difficulty: "Employee",
    seed: 12345,
    location: LOCATIONS.SF,
    actions: [{ minute: 1440, type: "sellFacility", payload: 3 }],
    ...overrides,
  };
}

function aSubmission(replay?: ReplayType, score = 420) {
  return {
    score,
    scoreBreakdown: { supply: 400, blackouts: 20 },
    scenarioId: 101,
    difficulty: "Employee" as const,
    replay,
  };
}

function writesTo(name: string) {
  return mockAddDoc.mock.calls.filter((call) => call[0].name === name);
}

function silenceWarnings() {
  return jest.spyOn(console, "warn").mockImplementation(() => undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddDoc.mockResolvedValue({ id: "replay-1" });
  mockSetDoc.mockResolvedValue(undefined);
  mockGetDocs.mockResolvedValue({
    empty: true,
    docs: [],
    forEach: () => undefined,
  });
  mockBatchCommit.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue(undefined);
});

describe("submitHighscore", () => {
  it("writes nothing for a player who isn't signed in", async () => {
    await makeStore().dispatch(submitHighscore(aSubmission(aReplay())));
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("stores the replay and points the score at it", async () => {
    await makeStore(SIGNED_IN).dispatch(
      submitHighscore(aSubmission(aReplay())),
    );

    const [replayWrite] = writesTo("replays");
    expect(replayWrite[1].seed).toBe(12345);
    // JSON rather than an array of maps, so it can't run into Firestore's rules about arrays
    expect(typeof replayWrite[1].actions).toBe("string");
    expect(replayWrite[1].uid).toBe("player-1");

    const [scoreWrite] = writesTo("scores");
    expect(scoreWrite[1].score).toBe(420);
    expect(scoreWrite[1].replayId).toBe("replay-1");
  });

  // Denormalized onto the score so that drawing a fifty row board is one query rather than
  // fifty-one, and so a board row survives the profile it came from being unreadable
  it("carries the player's leaderboard name onto the score", async () => {
    await makeStore({ ...SIGNED_IN, displayName: "Ada" }).dispatch(
      submitHighscore(aSubmission()),
    );
    expect(writesTo("scores")[0][1].displayName).toBe("Ada");
  });

  it("leaves the name off a score set before one was picked", async () => {
    await makeStore(SIGNED_IN).dispatch(submitHighscore(aSubmission()));
    // Firestore rejects a document carrying an undefined field
    expect("displayName" in writesTo("scores")[0][1]).toBe(false);
  });

  it("still submits the score when the run wasn't recorded", async () => {
    await makeStore(SIGNED_IN).dispatch(submitHighscore(aSubmission()));

    expect(writesTo("replays").length).toBe(0);
    const [scoreWrite] = writesTo("scores");
    expect(scoreWrite[1].score).toBe(420);
    expect("replayId" in scoreWrite[1]).toBe(false);
  });

  /**
   * A replay is a bonus on top of a score. Every way the extra write can fail -- rules that
   * haven't been deployed yet, a dropped network, an oversized run -- costs the replay and not
   * the score the player actually earned.
   */
  it("submits the score even when the replay write is rejected", async () => {
    const warn = silenceWarnings();
    mockAddDoc.mockRejectedValueOnce(new Error("permission-denied"));
    mockAddDoc.mockResolvedValueOnce({ id: "score-1" });

    await makeStore(SIGNED_IN).dispatch(
      submitHighscore(aSubmission(aReplay())),
    );

    const [scoreWrite] = writesTo("scores");
    expect(scoreWrite[1].score).toBe(420);
    expect("replayId" in scoreWrite[1]).toBe(false);
    warn.mockRestore();
  });

  it("drops a replay too big for a Firestore document", async () => {
    const warn = silenceWarnings();
    // One oversized payload rather than a realistic action list; what matters is the byte count
    const huge = aReplay({
      actions: [
        {
          minute: 0,
          type: "sellFacility",
          payload: "x".repeat(MAX_REPLAY_BYTES + 1),
        },
      ],
    });

    await makeStore(SIGNED_IN).dispatch(submitHighscore(aSubmission(huge)));

    expect(writesTo("replays").length).toBe(0);
    expect(writesTo("scores").length).toBe(1);
    warn.mockRestore();
  });

  it("records a first score as the personal best", async () => {
    const store = makeStore(SIGNED_IN);
    await store.dispatch(submitHighscore(aSubmission(undefined, 640)));

    expect(store.getState().user.bests?.["101"].score).toBe(640);
    // Mirrored onto the profile document too, so it survives a new browser
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe("users/player-1");
    expect(data.bests["101"].score).toBe(640);
  });

  it("replaces the personal best only when the run beat it", async () => {
    const store = makeStore({
      ...SIGNED_IN,
      bests: { "101": { score: 640, difficulty: "VP", date: 1 } },
    });

    await store.dispatch(submitHighscore(aSubmission(undefined, 500)));
    expect(store.getState().user.bests?.["101"].score).toBe(640);
    expect(mockSetDoc).not.toHaveBeenCalled();

    await store.dispatch(submitHighscore(aSubmission(undefined, 812)));
    expect(store.getState().user.bests?.["101"]).toEqual(
      expect.objectContaining({ score: 812, difficulty: "Employee" }),
    );
  });

  // Every scenario keeps its own best, so beating one must not wipe the others
  it("leaves other scenarios' bests alone", async () => {
    const store = makeStore({
      ...SIGNED_IN,
      bests: { "102": { score: 900, difficulty: "CEO", date: 1 } },
    });
    await store.dispatch(submitHighscore(aSubmission()));
    expect(store.getState().user.bests?.["102"].score).toBe(900);
    expect(store.getState().user.bests?.["101"].score).toBe(420);
  });
});

describe("loadProfile", () => {
  it("takes the name and bests off an existing profile", async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        displayName: "Ada",
        bests: { "101": { score: 640, difficulty: "VP", date: 1 } },
      }),
    });
    const store = makeStore(SIGNED_IN);
    await store.dispatch(loadProfile({ uid: "player-1" }));

    const user = store.getState().user;
    expect(user.displayName).toBe("Ada");
    expect(user.bests?.["101"].score).toBe(640);
    expect(user.profileLoaded).toBe(true);
    expect(user.needsDisplayName).toBe(false);
  });

  it("creates a profile on first login and asks for a name", async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    const store = makeStore(SIGNED_IN);
    await store.dispatch(loadProfile({ uid: "player-1" }));

    expect(mockSetDoc.mock.calls[0][0].path).toBe("users/player-1");
    expect(store.getState().user.needsDisplayName).toBe(true);
  });

  /**
   * The profile is a leaderboard nicety. Rules that haven't been deployed yet, or a player on a
   * plane, must not leave the game prompting for a name it could not save anyway.
   */
  it("doesn't prompt for a name it couldn't store", async () => {
    const warn = silenceWarnings();
    mockGetDoc.mockRejectedValue(new Error("permission-denied"));
    const store = makeStore(SIGNED_IN);
    await store.dispatch(loadProfile({ uid: "player-1" }));

    expect(store.getState().user.profileLoaded).toBe(true);
    expect(store.getState().user.needsDisplayName).toBeFalsy();
    warn.mockRestore();
  });
});

describe("saveDisplayName", () => {
  it("saves a normalized name only on the profile and merges other fields", async () => {
    const store = makeStore(SIGNED_IN);
    await store.dispatch(saveDisplayName("  Ada Lovelace "));
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: "users/player-1" },
      { displayName: "Ada Lovelace", updatedAt: "SERVER_TIMESTAMP" },
      { merge: true },
    );
    expect(mockGetDoc).not.toHaveBeenCalled();
    expect(store.getState().user.displayName).toBe("Ada Lovelace");
    expect(store.getState().user.needsDisplayName).toBe(false);
  });

  it("allows two players to save the same name", async () => {
    const first = makeStore(SIGNED_IN);
    const second = makeStore({ uid: "player-2" });
    await first.dispatch(saveDisplayName("Ada"));
    await second.dispatch(saveDisplayName("Ada"));
    expect(first.getState().user.displayName).toBe("Ada");
    expect(second.getState().user.displayName).toBe("Ada");
    expect(mockSetDoc.mock.calls.map(([ref]) => ref.path)).toEqual([
      "users/player-1",
      "users/player-2",
    ]);
  });

  it("renames a profile, including case-only changes", async () => {
    const store = makeStore({ ...SIGNED_IN, displayName: "Ada" });
    await store.dispatch(saveDisplayName("ada"));
    expect(store.getState().user.displayName).toBe("ada");
    await store.dispatch(saveDisplayName("Grace"));
    expect(store.getState().user.displayName).toBe("Grace");
  });

  it("rejects an invalid name without touching Firestore", async () => {
    const result = await makeStore(SIGNED_IN).dispatch(saveDisplayName("!!"));
    expect(saveDisplayName.rejected.match(result)).toBe(true);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("rejects when nobody is logged in", async () => {
    const result = await makeStore().dispatch(saveDisplayName("Ada"));
    expect(saveDisplayName.rejected.match(result)).toBe(true);
    expect(result.payload).toMatch(/logged in/);
  });

  it("reports a failed write rather than changing the previous name", async () => {
    const warn = silenceWarnings();
    mockSetDoc.mockRejectedValueOnce(new Error("unavailable"));
    const store = makeStore({ ...SIGNED_IN, displayName: "Grace" });
    const result = await store.dispatch(saveDisplayName("Ada"));

    expect(saveDisplayName.rejected.match(result)).toBe(true);
    expect(store.getState().user.displayName).toBe("Grace");
    expect(mockGetDocs).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // Cosmetic, and explicitly best effort: a rename must not fail because old rows couldn't be
  // refreshed
  it("keeps the name when backfilling old scores fails", async () => {
    const warn = silenceWarnings();
    mockGetDocs.mockRejectedValue(new Error("permission-denied"));
    const store = makeStore(SIGNED_IN);
    await store.dispatch(saveDisplayName("Ada"));

    expect(store.getState().user.displayName).toBe("Ada");
    warn.mockRestore();
  });

  it("rewrites the name on the player's own old scores", async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [],
      forEach: (fn: (d: { ref: string }) => void) => {
        fn({ ref: "scores/a" });
        fn({ ref: "scores/b" });
      },
    });
    await makeStore(SIGNED_IN).dispatch(saveDisplayName("Ada"));
    // The backfill is deliberately not awaited by the thunk
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockBatchUpdate).toHaveBeenCalledWith("scores/a", {
      displayName: "Ada",
    });
    expect(mockBatchCommit).toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("drops the whole slice, not just the uid", async () => {
    const store = makeStore({
      ...SIGNED_IN,
      displayName: "Ada",
      bests: { "101": { score: 640, difficulty: "VP", date: 1 } },
      profileLoaded: true,
    });
    await store.dispatch(logout());
    expect(store.getState().user).toEqual({});
  });

  // Sign-out failed, so the player is still signed in - clearing the slice would have shown them
  // a logged-out game they are not actually logged out of
  it("keeps the player signed in when sign-out fails", async () => {
    const warn = silenceWarnings();
    mockSignOut.mockRejectedValue(new Error("network"));
    const store = makeStore({ ...SIGNED_IN, displayName: "Ada" });
    await store.dispatch(logout());

    expect(store.getState().user.uid).toBe("player-1");
    warn.mockRestore();
  });
});

describe("fetchGlobalRank", () => {
  it("is one more than the number of runs that beat it", async () => {
    mockGetCount.mockResolvedValue({ data: () => ({ count: 3 }) });
    expect(await fetchGlobalRank(101, 812)).toBe(4);
    // Strictly greater, so the player's own run never counts against them
    const { parts } = mockGetCount.mock.calls[0][0];
    expect(parts).toContainEqual({ field: "score", op: ">", value: 812 });
  });

  it("is first when nothing beats it", async () => {
    mockGetCount.mockResolvedValue({ data: () => ({ count: 0 }) });
    expect(await fetchGlobalRank(101, 9999)).toBe(1);
  });
});
