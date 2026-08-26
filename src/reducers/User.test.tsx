import { configureStore } from "@reduxjs/toolkit";
import userReducer, {
  claimDisplayName,
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
const mockRunTransaction = jest.fn();
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
  runTransaction: (_db: unknown, fn: unknown) => mockRunTransaction(fn),
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
    startingYear: 2020,
    location: LOCATIONS.SF,
    durationMinutes: 43200,
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

/** A transaction that finds the claim document already held by `uid`, or by nobody. */
function transactionSeeing(holder?: string) {
  const get = jest.fn().mockResolvedValue({
    exists: () => holder !== undefined,
    data: () => ({ uid: holder }),
  });
  const set = jest.fn();
  const del = jest.fn();
  mockRunTransaction.mockImplementation(
    (fn: (t: unknown) => Promise<void>) =>
      fn({ get, set, delete: del }) as Promise<void>,
  );
  return { get, set, delete: del };
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

describe("claimDisplayName", () => {
  it("claims a free name and writes it to the profile", async () => {
    const transaction = transactionSeeing(undefined);
    const store = makeStore(SIGNED_IN);
    await store.dispatch(claimDisplayName("  Ada Lovelace "));

    expect(store.getState().user.displayName).toBe("Ada Lovelace");
    expect(store.getState().user.needsDisplayName).toBe(false);
    // Claimed lowercased, so Ada and ada cannot both be taken
    expect(transaction.set.mock.calls[0][0].path).toBe(
      "usernames/ada lovelace",
    );
    expect(transaction.set.mock.calls[1][0].path).toBe("users/player-1");
  });

  it("releases the old claim when renaming, in the same transaction", async () => {
    const transaction = transactionSeeing(undefined);
    await makeStore({ ...SIGNED_IN, displayName: "Ada" }).dispatch(
      claimDisplayName("Grace"),
    );
    expect(transaction.delete).toHaveBeenCalledWith({ path: "usernames/ada" });
  });

  // Re-saving the same name is a no-op, not a self-collision that would release the claim the
  // player is standing on
  it("doesn't release the claim when the name hasn't changed", async () => {
    const transaction = transactionSeeing("player-1");
    const store = makeStore({ ...SIGNED_IN, displayName: "Ada" });
    await store.dispatch(claimDisplayName("ada"));

    expect(transaction.delete).not.toHaveBeenCalled();
    expect(store.getState().user.displayName).toBe("ada");
  });

  it("fails cleanly on a name someone else holds, leaving the old one in place", async () => {
    transactionSeeing("someone-else");
    const store = makeStore({ ...SIGNED_IN, displayName: "Ada" });
    const result = await store.dispatch(claimDisplayName("Grace"));

    expect(claimDisplayName.rejected.match(result)).toBe(true);
    expect(result.payload).toMatch(/taken/);
    expect(store.getState().user.displayName).toBe("Ada");
  });

  it("rejects an invalid name without touching Firestore", async () => {
    const result = await makeStore(SIGNED_IN).dispatch(claimDisplayName("!!"));
    expect(claimDisplayName.rejected.match(result)).toBe(true);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("rejects when nobody is logged in", async () => {
    const result = await makeStore().dispatch(claimDisplayName("Ada"));
    expect(claimDisplayName.rejected.match(result)).toBe(true);
    expect(result.payload).toMatch(/logged in/);
  });

  it("reports a failed write rather than pretending the name was claimed", async () => {
    const warn = silenceWarnings();
    mockRunTransaction.mockRejectedValue(new Error("unavailable"));
    const store = makeStore(SIGNED_IN);
    const result = await store.dispatch(claimDisplayName("Ada"));

    expect(claimDisplayName.rejected.match(result)).toBe(true);
    expect(store.getState().user.displayName).toBeUndefined();
    warn.mockRestore();
  });

  // Cosmetic, and explicitly best effort: a rename must not fail because old rows couldn't be
  // refreshed
  it("keeps the name when backfilling old scores fails", async () => {
    const warn = silenceWarnings();
    transactionSeeing(undefined);
    mockGetDocs.mockRejectedValue(new Error("permission-denied"));
    const store = makeStore(SIGNED_IN);
    await store.dispatch(claimDisplayName("Ada"));

    expect(store.getState().user.displayName).toBe("Ada");
    warn.mockRestore();
  });

  it("rewrites the name on the player's own old scores", async () => {
    transactionSeeing(undefined);
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [],
      forEach: (fn: (d: { ref: string }) => void) => {
        fn({ ref: "scores/a" });
        fn({ ref: "scores/b" });
      },
    });
    await makeStore(SIGNED_IN).dispatch(claimDisplayName("Ada"));
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
