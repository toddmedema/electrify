import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  buildFacility,
  delta,
  reprioritizeFacility,
  sellFacility,
  togglePauseFacility,
  tickState,
} from "./Game";
import { GENERATORS } from "../data/Facilities";
import { decodeReplay, encodeReplay, serializeReplay } from "../Replay";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import { GameType, GeneratorShoppingType, ReplayType } from "../Types";

jest.setTimeout(120000);

// Rise of Renewables, entirely inside the recorded weather and price data
const OPTIONS = { scenarioId: 101, seed: 20260824 };
const PLAYED_MONTHS = 12;

function runMonths(state: GameType, months: number) {
  const until = state.date.monthsElapsed + months;
  while (state.date.monthsElapsed < until) {
    tickState(state);
  }
}

// Redux Toolkit freezes reducer output in development, and tickState mutates state in place
function dispatch(state: GameType, action: Parameters<typeof gameReducer>[1]) {
  return cloneDeep(gameReducer(state, action));
}

function aGeneratorToBuild(state: GameType): GeneratorShoppingType {
  const generator = GENERATORS(state, 500000000, [20], [500]).find(
    (g: GeneratorShoppingType) => g.available && g.fuel === "Natural Gas",
  );
  if (!generator) {
    throw new Error("No natural gas generator available to build");
  }
  return generator;
}

/**
 * A run with one of every recorded action in it, spread across the months so that each lands on a
 * different tick. Returns the finished state, from which the replay is taken.
 */
function playAScriptedGame(): GameType {
  let state = createGame(OPTIONS);

  runMonths(state, 2);
  state = dispatch(
    state,
    buildFacility({ facility: aGeneratorToBuild(state), financed: true }),
  );

  runMonths(state, 2);
  state = dispatch(state, delta({ dollarsPerkWh: 0.06 }));
  // Two deltas in the same minute: the sliders fire one of these per pixel dragged, and only the
  // last matters, so the recorder merges them
  state = dispatch(state, delta({ dollarsPerkWh: 0.065 }));

  runMonths(state, 2);
  state = dispatch(state, togglePauseFacility(state.facilities[0].id));

  runMonths(state, 2);
  state = dispatch(state, reprioritizeFacility({ spotInList: 0, delta: 1 }));

  runMonths(state, 2);
  state = dispatch(state, togglePauseFacility(state.facilities[1].id));
  state = dispatch(state, sellFacility(state.facilities[0].id));

  runMonths(state, PLAYED_MONTHS - 10);
  return state;
}

// What comes back off the network: a trip through the Firestore document shape and JSON
function roundTripped(replay: ReplayType): ReplayType {
  const doc = JSON.parse(JSON.stringify(encodeReplay(replay)));
  const decoded = decodeReplay(doc);
  if (!decoded) {
    throw new Error("A replay this module just wrote failed to decode");
  }
  return decoded;
}

describe("recording a run", () => {
  let played: GameType;

  beforeAll(() => {
    played = playAScriptedGame();
  });

  it("logs every action while the decision ledger cancels lifetime churn", () => {
    const types = played.replayLog!.map((a) => a.type);
    expect(types).toEqual([
      "buildFacility",
      "delta",
      "togglePauseFacility",
      "reprioritizeFacility",
      "togglePauseFacility",
      "sellFacility",
    ]);
    // The two pause clicks ultimately return the same plant to its baseline state, so they remain
    // in the replay but correctly disappear from persistent decision progress.
    expect(played.meaningfulDecisions).toHaveLength(4);
    expect(new Set(played.meaningfulDecisions.map(({ key }) => key)).size).toBe(
      4,
    );
  });

  it("counts only accepted settled changes, not rejected targets or lifetime churn", () => {
    let state = createGame(OPTIONS);
    const startingRate = state.dollarsPerkWh;

    state = dispatch(state, delta({ dollarsPerkWh: startingRate + 0.001 }));
    runMonths(state, 1);
    state = dispatch(state, delta({ dollarsPerkWh: startingRate + 0.002 }));
    expect(state.meaningfulDecisions).toHaveLength(1);
    expect(state.meaningfulDecisions[0]).toMatchObject({
      lever: "rate",
      before: String(startingRate),
      after: String(startingRate + 0.002),
      month: 1,
    });

    runMonths(state, 1);
    state = dispatch(state, delta({ dollarsPerkWh: startingRate }));
    expect(state.meaningfulDecisions).toHaveLength(0);

    state = dispatch(state, sellFacility(999999));
    state = dispatch(state, togglePauseFacility(999999));
    state = dispatch(
      state,
      reprioritizeFacility({ spotInList: 999999, delta: 1 }),
    );
    expect(state.meaningfulDecisions).toHaveLength(0);
  });

  it("merges the deltas fired within one minute into the value that stuck", () => {
    const deltas = played.replayLog!.filter((a) => a.type === "delta");
    expect(deltas.length).toBe(1);
    expect(deltas[0].payload).toEqual({ dollarsPerkWh: 0.065 });
  });

  it("stamps each action with a tick boundary inside the run", () => {
    played.replayLog!.forEach((action) => {
      expect(action.minute % 15).toBe(0);
      expect(action.minute).toBeGreaterThan(0);
      expect(action.minute).toBeLessThanOrEqual(played.date.minute);
    });
  });

  /**
   * A scenario id used to be enough to say where a run happened. It isn't any more -- a custom
   * game carries its own location, and an authored one can be given one that isn't in LOCATIONS
   * -- so the replay has to record it, and watching one has to read it back rather than looking
   * the scenario up again. Without both halves a replay is re-simulated against another city's
   * weather and stops matching the run it claims to be.
   */
  it("records where the run was played", () => {
    const replay = serializeReplay(played)!;
    expect(replay.location).toEqual(played.location);
  });

  it("is watched at the location it recorded, not the scenario's", () => {
    const replay = roundTripped(serializeReplay(played)!);
    const elsewhere = {
      ...replay,
      // Same weather file, so the run still loads; everything else is what a location outside
      // LOCATIONS would bring, and none of it can come from a scenario lookup
      location: {
        id: replay.location.id,
        name: "Somewhere Not In LOCATIONS",
        lat: 12.3456,
        long: 65.4321,
        timeZone: "Etc/UTC",
      },
    };

    expect(createGameFromReplay(elsewhere).location).toEqual(
      elsewhere.location,
    );
  });

  it("stays small enough to hang off a high score", () => {
    // A whole save of the same run is hundreds of kilobytes; this is the reason replays are
    // stored as actions rather than as states
    const bytes = JSON.stringify(encodeReplay(serializeReplay(played)!)).length;
    expect(bytes).toBeLessThan(10000);
  });
});

describe("watching a replay", () => {
  let played: GameType;
  let replay: ReplayType;

  beforeAll(() => {
    played = playAScriptedGame();
    replay = roundTripped(serializeReplay(played)!);
  });

  it("preserves an explicit decision-gate waiver during current playback", () => {
    const doc = encodeReplay(serializeReplay(played)!) as unknown as Record<
      string,
      unknown
    >;
    doc.meaningfulDecisionGateWaived = true;
    const legacy = decodeReplay(doc)!;
    const watched = createGameFromReplay(legacy);

    expect(legacy.meaningfulDecisionGateWaived).toBe(true);
    expect(watched.meaningfulDecisionGateWaived).toBe(true);
  });

  /**
   * The whole point of the feature: the seed fixes the weather and the fuel prices, the log fixes
   * everything the player did, and between them the run comes out the same to the cent.
   */
  it("reproduces the original run exactly", () => {
    const watched = createGameFromReplay(replay);
    runMonths(watched, PLAYED_MONTHS);

    expect(watched.date.minute).toBe(played.date.minute);
    expect(watched.monthlyHistory).toEqual(played.monthlyHistory);
    expect(watched.facilities).toEqual(played.facilities);
    expect(watched.meaningfulDecisions).toEqual(played.meaningfulDecisions);
  });

  it("applies each action at the minute it was taken", () => {
    const watched = createGameFromReplay(replay);
    const buildAt = replay.actions.find(
      (a) => a.type === "buildFacility",
    )!.minute;
    const before = watched.facilities.length;

    while (watched.date.minute < buildAt) {
      tickState(watched);
    }
    expect(watched.facilities.length).toBe(before + 1);
  });

  it("doesn't record itself", () => {
    const watched = createGameFromReplay(replay);
    runMonths(watched, PLAYED_MONTHS);

    expect(watched.replayLog).toBeUndefined();
    expect(serializeReplay(watched)).toBeUndefined();
  });

  it("runs out of actions without running out of game", () => {
    const watched = createGameFromReplay(replay);
    runMonths(watched, PLAYED_MONTHS + 6);

    expect(watched.replayPlayback!.index).toBe(replay.actions.length);
    expect(watched.monthlyHistory.length).toBeGreaterThan(
      played.monthlyHistory.length,
    );
  });
});
