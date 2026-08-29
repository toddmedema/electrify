import {
  decodeReplay,
  encodeReplay,
  MAX_REPLAY_ACTIONS,
  recordReplayAction,
  recordedDelta,
  replayByteLength,
  REPLAY_VERSION,
} from "./Replay";
import { LOCATIONS } from "./Constants";
import { GameType, ReplayActionType, ReplayType } from "./Types";

// Only the two fields the recorder touches, so these tests don't need a whole simulation to run
function aGame(minute: number, log?: ReplayActionType[]): GameType {
  return {
    date: { minute },
    replayLog: log,
  } as unknown as GameType;
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
    actions: [
      { minute: 0, type: "delta", payload: { dollarsPerkWh: 0.12 } },
      { minute: 1440, type: "sellFacility", payload: 3 },
    ],
    ...overrides,
  };
}

describe("recordedDelta", () => {
  it("keeps the fields the simulation reads", () => {
    expect(recordedDelta({ dollarsPerkWh: 0.11 })).toEqual({
      dollarsPerkWh: 0.11,
    });
  });

  it("ignores a delta that changes nothing about the run", () => {
    // The UI fires far more of these than it does rate changes -- tutorial steps, the custom
    // scenario, the difficulty picked before the game began
    expect(recordedDelta({ tutorialStep: 3 })).toBeNull();
    expect(recordedDelta({ difficulty: "CEO" })).toBeNull();
  });

  it("rejects an invalid rate from an untrusted replay", () => {
    expect(recordedDelta({ dollarsPerkWh: Number.NaN })).toBeNull();
    expect(recordedDelta({ dollarsPerkWh: -0.01 })).toBeNull();
  });
});

describe("recordReplayAction", () => {
  it("does nothing when the run isn't being recorded", () => {
    const game = aGame(60);
    recordReplayAction(game, "sellFacility", 1);
    expect(game.replayLog).toBeUndefined();
  });

  it("stamps the action with the minute it happened", () => {
    const game = aGame(1440, []);
    recordReplayAction(game, "sellFacility", 7);
    expect(game.replayLog).toEqual([
      { minute: 1440, type: "sellFacility", payload: 7 },
    ]);
  });

  it("copies the payload, since the simulation mutates the object it was handed", () => {
    const game = aGame(60, []);
    const facility = { name: "Coal", peakW: 100 };
    recordReplayAction(game, "buildFacility", { facility, financed: true });
    facility.peakW = 999;
    expect(
      (game.replayLog![0].payload as { facility: { peakW: number } }).facility
        .peakW,
    ).toBe(100);
  });

  it("round-trips an Airborne Wind build action", () => {
    const replay = aReplay({
      actions: [
        {
          minute: 0,
          type: "buildFacility",
          payload: {
            facility: {
              name: "Airborne Wind",
              fuel: "Airborne Wind",
              peakW: 1200000,
            },
            financed: true,
          },
        },
      ],
    });
    expect(
      decodeReplay(JSON.parse(JSON.stringify(encodeReplay(replay)))),
    ).toEqual(replay);
  });

  it("round-trips an Oil build's variable O&M", () => {
    const replay = aReplay({
      actions: [
        {
          minute: 0,
          type: "buildFacility",
          payload: {
            facility: {
              name: "Oil",
              fuel: "Oil",
              peakW: 100000000,
              annualOperatingCost: 3085368.560061,
              variableOperatingCostPerMWh: 25.711404667176,
            },
            financed: false,
          },
        },
      ],
    });
    expect(
      decodeReplay(JSON.parse(JSON.stringify(encodeReplay(replay)))),
    ).toEqual(replay);
  });

  it("merges deltas fired within one minute", () => {
    const game = aGame(60, []);
    recordReplayAction(game, "delta", { dollarsPerkWh: 0.1 });
    recordReplayAction(game, "delta", { dollarsPerkWh: 0.2 });
    expect(game.replayLog).toEqual([
      {
        minute: 60,
        type: "delta",
        payload: { dollarsPerkWh: 0.2 },
      },
    ]);
  });

  it("keeps deltas from different minutes apart", () => {
    const game = aGame(60, []);
    recordReplayAction(game, "delta", { dollarsPerkWh: 0.1 });
    game.date.minute = 75;
    recordReplayAction(game, "delta", { dollarsPerkWh: 0.2 });
    expect(game.replayLog!.length).toBe(2);
  });

  /**
   * Half a replay would play back as a different game while claiming to be the real one, so a run
   * that outgrows the cap gives up on its replay rather than shipping a truncated one.
   */
  it("stops recording rather than truncating once the cap is reached", () => {
    const game = aGame(60, []);
    for (let i = 0; i < MAX_REPLAY_ACTIONS; i++) {
      game.date.minute = 15 * i;
      recordReplayAction(game, "sellFacility", i);
    }
    expect(game.replayLog!.length).toBe(MAX_REPLAY_ACTIONS);

    game.date.minute = 15 * MAX_REPLAY_ACTIONS;
    recordReplayAction(game, "sellFacility", MAX_REPLAY_ACTIONS);
    expect(game.replayLog).toBeUndefined();
  });
});

describe("encodeReplay", () => {
  it("stores the actions as JSON, so nothing nests inside a Firestore array", () => {
    const doc = encodeReplay(aReplay());
    expect(typeof doc.actions).toBe("string");
    expect(JSON.parse(doc.actions).length).toBe(2);
  });

  it("measures what will actually be stored", () => {
    expect(replayByteLength(encodeReplay(aReplay()))).toBe(
      JSON.stringify(encodeReplay(aReplay())).length,
    );
  });
});

describe("decodeReplay", () => {
  it("round-trips a replay through the document shape", () => {
    const replay = aReplay();
    expect(
      decodeReplay(JSON.parse(JSON.stringify(encodeReplay(replay)))),
    ).toEqual(replay);
  });

  it("ignores anything that isn't a replay", () => {
    expect(decodeReplay(null)).toBeNull();
    expect(decodeReplay("nope")).toBeNull();
    expect(decodeReplay({})).toBeNull();
  });

  it("ignores a replay from a schema it doesn't understand", () => {
    expect(
      decodeReplay(encodeReplay(aReplay({ version: REPLAY_VERSION + 1 }))),
    ).toBeNull();
  });

  it("ignores a replay missing the fields the run is rebuilt from", () => {
    const doc = encodeReplay(aReplay()) as unknown as Record<string, unknown>;
    delete doc.seed;
    expect(decodeReplay(doc)).toBeNull();
  });

  it("ignores a replay that doesn't say where it was played", () => {
    const doc = encodeReplay(aReplay()) as unknown as Record<string, unknown>;
    delete doc.location;
    expect(decodeReplay(doc)).toBeNull();
  });

  it("ignores a location that isn't one", () => {
    const bad = [
      "SF",
      { id: "SF" },
      { ...LOCATIONS.SF, lat: 91 },
      { ...LOCATIONS.SF, long: "west" },
      // The id becomes the path of the weather file the loading screen fetches
      { ...LOCATIONS.SF, id: "../../secrets" },
    ];
    bad.forEach((location: unknown) => {
      expect(decodeReplay({ ...encodeReplay(aReplay()), location })).toBeNull();
    });
  });

  it("keeps a location the game doesn't ship, so a custom run replays where it was played", () => {
    const unlisted = {
      id: "REY",
      name: "Reykjavik, Iceland",
      lat: 64.1466,
      long: -21.9426,
      timeZone: "Atlantic/Reykjavik",
    };
    const decoded = decodeReplay(
      JSON.parse(JSON.stringify(encodeReplay(aReplay({ location: unlisted })))),
    );
    expect(decoded!.location).toEqual(unlisted);
  });

  /**
   * Playback drives the real reducer, so everything below would otherwise reach the simulation
   * mid-tick. These are documents off the network -- another player's, or a hand-edited one.
   */
  it("ignores actions that aren't valid JSON", () => {
    expect(
      decodeReplay({ ...encodeReplay(aReplay()), actions: "{" }),
    ).toBeNull();
  });

  it("ignores an action the reducer has no handler for", () => {
    const doc = encodeReplay(aReplay());
    doc.actions = JSON.stringify([
      { minute: 0, type: "dropTheDatabase", payload: {} },
    ]);
    expect(decodeReplay(doc)).toBeNull();
  });

  it("ignores an action with no usable timestamp", () => {
    const doc = encodeReplay(aReplay());
    doc.actions = JSON.stringify([{ minute: -1, type: "sellFacility" }]);
    expect(decodeReplay(doc)).toBeNull();
  });

  it("ignores actions that run backwards", () => {
    // Applied against a clock that only moves forwards, so everything after the step backwards
    // would silently never be applied
    const doc = encodeReplay(aReplay());
    doc.actions = JSON.stringify([
      { minute: 1440, type: "sellFacility", payload: 1 },
      { minute: 60, type: "sellFacility", payload: 2 },
    ]);
    expect(decodeReplay(doc)).toBeNull();
  });

  it("ignores a replay with more actions than one could ever record", () => {
    const doc = encodeReplay(aReplay());
    doc.actions = JSON.stringify(
      new Array(MAX_REPLAY_ACTIONS + 1).fill({
        minute: 0,
        type: "sellFacility",
        payload: 1,
      }),
    );
    expect(decodeReplay(doc)).toBeNull();
  });
});
