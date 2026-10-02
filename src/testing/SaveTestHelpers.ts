import { LOCATIONS } from "../Constants";
import {
  emptyTransmissionState,
  intertiesEnabledForScenario,
} from "../data/AdjacentMarkets";
import { getScenario } from "../data/Scenarios";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import type { GameType, SaveFileType, SavedRunResult } from "../Types";
import { serializeSave } from "../SaveGame";

/** Small valid payload without initializing weather/economics or advancing the simulation. */
export function fakeSaveGame(overrides: Partial<GameType> = {}): GameType {
  const game = {
    scenarioId: 101,
    difficulty: "Employee",
    seed: 31337,
    startingYear: 2020,
    customerMarketSize: 2_000_000,
    customerRate: 0.07,
    startingDemandScale: 1,
    loadAdditions: [],
    location: LOCATIONS.PIT,
    date: getDateFromMinute(185 * MINUTES_PER_MONTH + 1000, 2020),
    commissionedHydroSiteIds: [],
    facilities: [],
    timeline: [],
    monthlyHistory: [],
    eventLog: [],
    reportedEventKeys: [],
    eventLogReadThroughId: 0,
    worldEvents: { active: [], occurrences: [], checkedKeys: [] },
    meaningfulDecisions: [],
    meaningfulDecisionGateWaived: false,
    ...overrides,
  } as unknown as GameType;
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (scenario && intertiesEnabledForScenario(scenario, game.location))
    game.transmission = emptyTransmissionState();
  return game;
}

export function fakeSaveFile(
  overrides: Partial<SaveFileType> = {},
): SaveFileType {
  return {
    name: "Renewables experiment",
    status: "inProgress",
    save: serializeSave(fakeSaveGame()),
    ...overrides,
  };
}

export function fakeSavedResult(
  overrides: Partial<SavedRunResult> = {},
): SavedRunResult {
  return {
    scenarioId: 101,
    scenarioName: "Rise of Renewables",
    difficulty: "Employee",
    score: 600,
    breakdown: { supply: 150, customers: 450 },
    outcome: "completed",
    ...overrides,
  };
}
