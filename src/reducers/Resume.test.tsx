import cloneDeep from "lodash.clonedeep";
import gameReducer, { loaded, resume, start, tickState } from "./Game";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { GameType } from "../Types";
import {
  OIL_FIXED_OPERATING_COST_PER_KW_YEAR,
  OIL_VARIABLE_OPERATING_COST_PER_MWH,
} from "../data/Facilities";

jest.setTimeout(60000);

// Rise of Renewables, entirely inside the recorded weather and price data
const OPTIONS = { scenarioId: 101, seed: 8675309 };
const PLAYED_MONTHS = 6;

function runMonths(state: GameType, months: number) {
  const until = state.date.monthsEllapsed + months;
  while (state.date.monthsEllapsed < until) {
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

  it("upgrades old thermal facilities without inventing an opening start", () => {
    const oldSave = serialized(createGame({ scenarioId: 103, seed: 8675309 }));
    const coal = oldSave.facilities.find(
      (facility) => facility.name === "Coal",
    )!;
    coal.tracksStarts = undefined;
    coal.costPerStart = undefined;
    coal.lifetimeStarts = undefined;
    coal.generatingLastRealTick = undefined;

    const restored = restore(oldSave);
    const restoredCoal = restored.facilities.find(
      (facility) => facility.name === "Coal",
    )!;
    expect(restoredCoal.tracksStarts).toBe(true);
    expect(restoredCoal.costPerStart).toBeUndefined();
    expect(restoredCoal.lifetimeStarts).toBe(0);
    expect(restoredCoal.generatingLastRealTick).toBe(restoredCoal.currentW > 0);
  });

  it("migrates legacy Oil O&M with its saved difficulty and vintage multiplier", () => {
    const oldSave = serialized(createGame({ scenarioId: 101, seed: 8675309 }));
    const oil = oldSave.facilities.find((facility) => facility.name === "Oil")!;
    const multiplier = 1.37;
    const historicalExpenses = oil.lifetimeExpenses;
    oil.annualOperatingCost = 0.05 * oil.peakW * multiplier;
    oil.variableOperatingCostPerMWh = undefined;

    const restoredOil = restore(oldSave).facilities.find(
      (facility) => facility.name === "Oil",
    )!;
    expect(restoredOil.annualOperatingCost).toBeCloseTo(
      (restoredOil.peakW / 1000) *
        OIL_FIXED_OPERATING_COST_PER_KW_YEAR *
        multiplier,
      6,
    );
    expect(restoredOil.variableOperatingCostPerMWh).toBeCloseTo(
      OIL_VARIABLE_OPERATING_COST_PER_MWH * multiplier,
      10,
    );
    expect(restoredOil.lifetimeExpenses).toBe(historicalExpenses);
    expect(Number.isFinite(restoredOil.annualOperatingCost)).toBe(true);
    expect(Number.isFinite(restoredOil.variableOperatingCostPerMWh)).toBe(true);
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
