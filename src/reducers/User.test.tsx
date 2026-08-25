import userReducer, { submitHighscore } from "./User";
import { MAX_REPLAY_BYTES, REPLAY_VERSION } from "../Replay";
import { LOCATIONS } from "../Constants";
import { ReplayType, UserType } from "../Types";

const mockAddDoc = jest.fn();

jest.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (_db: unknown, name: string) => ({ name }),
  serverTimestamp: () => "SERVER_TIMESTAMP",
}));

jest.mock("../Globals", () => ({
  getDb: () => ({}),
}));

const SIGNED_IN: UserType = { uid: "player-1" };

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

function aSubmission(replay?: ReplayType) {
  return {
    score: 420,
    scoreBreakdown: { supply: 400, blackouts: 20 },
    scenarioId: 101,
    difficulty: "Employee" as const,
    replay,
  };
}

// The writes are fired off without being awaited -- nothing in the app waits on them either
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function writesTo(name: string) {
  return mockAddDoc.mock.calls.filter((call) => call[0].name === name);
}

describe("submitHighscore", () => {
  beforeEach(() => {
    mockAddDoc.mockReset();
    mockAddDoc.mockResolvedValue({ id: "replay-1" });
  });

  it("writes nothing for a player who isn't signed in", async () => {
    userReducer({}, submitHighscore(aSubmission(aReplay())));
    await settled();
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("stores the replay and points the score at it", async () => {
    userReducer(SIGNED_IN, submitHighscore(aSubmission(aReplay())));
    await settled();

    const [replayWrite] = writesTo("replays");
    expect(replayWrite[1].seed).toBe(12345);
    // JSON rather than an array of maps, so it can't run into Firestore's rules about arrays
    expect(typeof replayWrite[1].actions).toBe("string");
    expect(replayWrite[1].uid).toBe("player-1");

    const [scoreWrite] = writesTo("scores");
    expect(scoreWrite[1].score).toBe(420);
    expect(scoreWrite[1].replayId).toBe("replay-1");
  });

  it("still submits the score when the run wasn't recorded", async () => {
    userReducer(SIGNED_IN, submitHighscore(aSubmission()));
    await settled();

    expect(writesTo("replays").length).toBe(0);
    const [scoreWrite] = writesTo("scores");
    expect(scoreWrite[1].score).toBe(420);
    // Firestore rejects a document carrying an undefined field
    expect("replayId" in scoreWrite[1]).toBe(false);
  });

  /**
   * A replay is a bonus on top of a score. Every way the extra write can fail -- rules that
   * haven't been deployed yet, a dropped network, an oversized run -- costs the replay and not
   * the score the player actually earned.
   */
  it("submits the score even when the replay write is rejected", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockAddDoc.mockRejectedValueOnce(new Error("permission-denied"));
    mockAddDoc.mockResolvedValueOnce({ id: "score-1" });

    userReducer(SIGNED_IN, submitHighscore(aSubmission(aReplay())));
    await settled();

    const [scoreWrite] = writesTo("scores");
    expect(scoreWrite[1].score).toBe(420);
    expect("replayId" in scoreWrite[1]).toBe(false);
    warn.mockRestore();
  });

  it("drops a replay too big for a Firestore document", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
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

    userReducer(SIGNED_IN, submitHighscore(aSubmission(huge)));
    await settled();

    expect(writesTo("replays").length).toBe(0);
    expect(writesTo("scores").length).toBe(1);
    warn.mockRestore();
  });
});
