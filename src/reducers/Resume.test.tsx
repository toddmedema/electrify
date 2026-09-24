import cloneDeep from "lodash.clonedeep";
import gameReducer, { loaded, resume, start, tickState } from "./Game";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { getSimLocation } from "../testing/SimData";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import {
  copyCommitmentMetadata,
  serializeCommitmentMetadata,
} from "../helpers/Commitment";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { GameType, ScenarioType } from "../Types";

jest.setTimeout(60000);

// Rise of Renewables, entirely inside the recorded weather and price data
const OPTIONS = { scenarioId: 101, seed: 8675309 };
const PLAYED_MONTHS = 6;

function runMonths(state: GameType, months: number) {
  const until = state.date.monthsElapsed + months;
  while (state.date.monthsElapsed < until) {
    tickState(state);
  }
}

// Redux Toolkit freezes reducer output in development, and tickState mutates state in place
function restore(saved: GameType): GameType {
  return cloneDeep(gameReducer(undefined, resume(saved)));
}

// What a reload hands back: the slice after a trip through JSON and the save envelope
function serialized(state: GameType): GameType {
  return parseSave(JSON.parse(JSON.stringify(serializeSave(state))))!.game;
}

describe("resume", () => {
  let played: GameType;

  beforeAll(() => {
    played = createGame(OPTIONS);
    runMonths(played, PLAYED_MONTHS);
  });

  it("restores the saved slice", () => {
    const restored = restore(serialized(played));
    expect(restored.seed).toBe(played.seed);
    expect(restored.scenarioId).toBe(played.scenarioId);
    expect(restored.date.minute).toBe(played.date.minute);
    expect(restored.facilities).toEqual(played.facilities);
    expect(restored.monthlyHistory).toEqual(played.monthlyHistory);
  });

  it("comes back paused and out of game until loaded", () => {
    const restored = restore({ ...serialized(played), speed: "FAST" });
    expect(restored.speed).toBe("PAUSED");
    expect(restored.inGame).toBe(false);
    expect(gameReducer(restored, loaded()).inGame).toBe(true);
  });

  /**
   * The regression the restored previousMonth guards: the tick loop's month tracker lives outside
   * Redux, so a resume that cleared it (the way initGame does) would roll the month over on the
   * very first tick and record a second history entry for a month already in the log.
   */
  it("doesn't re-record the month it was saved in", () => {
    const restored = restore(serialized(played));
    const before = restored.monthlyHistory.length;

    // One tick past the resume shouldn't roll anything over...
    tickState(restored);
    expect(restored.monthlyHistory.length).toBe(before);

    // ...and a full month should add exactly one entry
    runMonths(restored, 1);
    expect(restored.monthlyHistory.length).toBe(before + 1);
  });

  it("picks up the run the save was taken from", () => {
    // Built from scratch rather than cloned, so the tick loop's out-of-store locals are reset the
    // way they would be for a run that was never interrupted
    const uninterrupted = createGame(OPTIONS);
    runMonths(uninterrupted, PLAYED_MONTHS + 3);

    const restored = restore(serialized(played));
    runMonths(restored, 3);

    expect(restored.monthlyHistory).toEqual(uninterrupted.monthlyHistory);
  });

  it("starts a new game with an empty timeline so the loading screen can tell them apart", () => {
    expect(gameReducer(played, start(101)).timeline).toEqual([]);
  });
});

/**
 * A custom game modeled on Carbon Fee, moved to Dallas. Saved a few ticks before the end of month
 * 31, the resumed run used to drift from the one that kept going: parseSave invented an empty
 * policies record the live game never had, and loaded() rebuilt the unit-commitment forecast by
 * re-dispatching the tick that had already happened, which rewrote its supply and fuel and moved
 * the month's totals.
 */
describe("resuming a save mid-month", () => {
  const SAVED_AT_MINUTE = 46035; // Month 31, three ticks before it rolls over
  let played: GameType;
  let saved: GameType;

  // Unfreezes reducer output the way restore() does, but keeps the commitment forecast that
  // cloneDeep would drop, so the resumed run steers by the same forecast the game would
  function thaw(state: GameType): GameType {
    const thawed = cloneDeep(state);
    state.timeline.forEach((tick, i) =>
      copyCommitmentMetadata(tick, thawed.timeline[i]),
    );
    return thawed;
  }

  function resumed(): GameType {
    return thaw(gameReducer(gameReducer(undefined, resume(saved)), loaded()));
  }

  beforeAll(() => {
    const base = SCENARIOS.find((s: ScenarioType) => s.id === 100)!;
    const scenario = {
      ...base,
      id: CUSTOM_SCENARIO_ID,
      locationId: "Dallas",
      location: getSimLocation("Dallas"),
    } as ScenarioType;
    played = createGame({ scenarioId: CUSTOM_SCENARIO_ID, scenario, seed: 11 });
    while (played.date.minute < SAVED_AT_MINUTE) {
      tickState(played);
    }
    saved = serialized(played);
  });

  it("carries the commitment forecast through the save", () => {
    const forecast = serializeCommitmentMetadata(played.timeline);
    expect(forecast?.some((tick) => tick !== null)).toBe(true);
    expect(serializeCommitmentMetadata(resumed().timeline)).toEqual(forecast);
  });

  it("leaves the tick that already happened as it was recorded", () => {
    const restored = resumed();
    expect(
      getTimeFromTimeline(restored.date.minute, restored.timeline),
    ).toEqual(getTimeFromTimeline(played.date.minute, played.timeline));
  });

  it("keeps a missing forecast from rewriting the recorded timeline", () => {
    const envelope = JSON.parse(JSON.stringify(serializeSave(played)));
    delete envelope.commitmentForecast;
    const withoutForecast = parseSave(envelope)!.game;
    const reloaded = gameReducer(
      gameReducer(undefined, resume(withoutForecast)),
      loaded(),
    );
    expect(reloaded.timeline).toEqual(withoutForecast.timeline);
  });

  it("doesn't invent policies the live game never had", () => {
    expect(played.policies).toBeUndefined();
    expect(saved.policies).toBeUndefined();
  });

  it("follows the uninterrupted run through the month's end", () => {
    const restored = resumed();
    const uninterrupted = thaw(played);
    for (let i = 0; i < 100; i++) {
      tickState(uninterrupted);
      tickState(restored);
      expect(restored.policies).toEqual(uninterrupted.policies);
      expect(restored.facilities).toEqual(uninterrupted.facilities);
    }
    expect(restored.monthlyHistory).toEqual(uninterrupted.monthlyHistory);
  });
});

/**
 * How long a blackout lasted and how much demand it left unserved used to live outside Redux, and
 * resume() reset them to "started just now, nothing missed yet". A save taken partway through a
 * blackout then reported a shorter, cheaper one once the lights came back.
 */
describe("resuming a save mid-blackout", () => {
  // Scenario 102 on this seed goes dark from minute 9465 to 9795; save halfway through
  const BLACKOUT_OPTIONS = { scenarioId: 102, seed: 8675309 };
  const SAVED_AT_MINUTE = 9600;

  function runPast(state: GameType, minute: number) {
    while (state.date.minute < minute) {
      tickState(state);
    }
  }

  function blackoutsOver(state: GameType) {
    return state.eventLog.filter(({ kind }) => kind === "BLACKOUT_OVER");
  }

  it("reports the blackout the way the uninterrupted run does", () => {
    const uninterrupted = createGame(BLACKOUT_OPTIONS);
    runPast(uninterrupted, SAVED_AT_MINUTE);
    expect(uninterrupted.blackout).toBeDefined();
    const saved = serialized(uninterrupted);
    expect(saved.blackout).toEqual(uninterrupted.blackout);

    const restored = restore(saved);
    runPast(uninterrupted, 10000);
    runPast(restored, 10000);

    expect(blackoutsOver(uninterrupted)).toHaveLength(1);
    expect(restored.eventLog).toEqual(uninterrupted.eventLog);
  });

  it("rejects a save with an impossible blackout", () => {
    const played = createGame(BLACKOUT_OPTIONS);
    runPast(played, SAVED_AT_MINUTE);
    const envelope = JSON.parse(JSON.stringify(serializeSave(played)));
    for (const blackout of [
      { startMinute: played.date.minute + 1, unservedWh: 0 },
      { startMinute: -1, unservedWh: 0 },
      { startMinute: 1.5, unservedWh: 0 },
      { startMinute: 0, unservedWh: -1 },
      { startMinute: 0, unservedWh: "1" },
      { startMinute: 0, unservedWh: null },
      null,
      "dark",
    ]) {
      expect(
        parseSave({ ...envelope, game: { ...envelope.game, blackout } }),
      ).toBeNull();
    }
    expect(parseSave(envelope)!.game.blackout).toEqual(played.blackout);
  });
});
