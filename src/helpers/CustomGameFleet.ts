import { getDateFromMinute } from "./DateTime";
import { getStartingCustomers } from "../data/LocationProfiles";
import { getStartingFacilityAge } from "../data/StartingFacilityAges";
import { forecastCustomGameTimeline } from "./CustomGameForecast";
import { DATA_CENTER_DIFFICULTY } from "./DataCenterScenario";
import {
  allocateCalibratedFleet,
  withRegionalStartingFleet,
} from "./RegionalStartingFleet";
import { getScenarioLocation } from "./Locations";
import { roundToSignificantDigits } from "./Math";
import { startingFacilityQuote } from "./StartingFacilities";
import { sizeStartingFleet } from "./StartingFleetSizing";
import {
  FuelNameType,
  GameType,
  ScenarioFacilityType,
  ScenarioType,
} from "../Types";

export interface CustomGameFleetRequest {
  requestId: number;
  scenario: ScenarioType;
  seed: number;
}

export type CustomGameFleetResponse =
  | { requestId: number; facilities: ScenarioFacilityType[] }
  | { requestId: number; error: string };

/** Firm plants in the order a reserve is built when the regional blend cannot serve demand. */
const RESERVE_PLANTS = [
  "Natural Gas CC",
  "Natural Gas Steam",
  "Natural Gas Peaker",
  "Coal",
  "Oil",
];

/** The seed and difficulty setup is sized at: the hardest, so every easier one is covered too. */
const FLEET_DIFFICULTY = DATA_CENTER_DIFFICULTY;

/**
 * The local grid's blend of plants, sized so the first year is served in the real model: the
 * same regional capacity mix and forecast-driven sizing as the data-center setup, applied to
 * a custom game's location, era and customers. Runs only after simulation data is loaded,
 * normally inside a worker.
 */
export function sizeCustomGameFleet(
  scenario: ScenarioType,
  seed: number,
): ScenarioFacilityType[] {
  const location = getScenarioLocation(scenario);
  if (!location) throw new Error("The custom setup has no playable location");
  const customers =
    scenario.startingCustomers || getStartingCustomers(location);
  const { startingYear } = scenario;
  // Only what initGame resolves starting facilities against, so nothing is offered that would be
  // silently dropped on the way into the game (no solar before 1982, no batteries before 2008).
  const state = {
    date: getDateFromMinute(0, startingYear),
    startingYear,
    difficulty: FLEET_DIFFICULTY,
    feePerKgCO2e: scenario.feePerKgCO2e,
    seed: 0,
    facilities: [],
    commissionedHydroSiteIds: [],
    scenarioId: 0,
    customScenario: scenario,
    location,
  } as unknown as GameType;
  const available = withRegionalStartingFleet(scenario).facilities.flatMap(
    (facility): ScenarioFacilityType[] => {
      const quote = startingFacilityQuote(state, facility);
      return quote ? [{ ...facility, name: quote.name }] : [];
    },
  );
  const reserveName = RESERVE_PLANTS.find((name) =>
    startingFacilityQuote(state, { name, peakW: 1000000 }),
  );
  const reserve = (shortfallW: number): ScenarioFacilityType => {
    const fuel = startingFacilityQuote(state, {
      name: reserveName,
      peakW: 1000000,
    })?.fuel as FuelNameType | undefined;
    if (!reserveName || !fuel)
      throw new Error(
        "We couldn't prepare a reliable starting grid for this location.",
      );
    return {
      name: reserveName,
      fuel,
      peakW: Math.ceil(shortfallW),
      initialAgeYears: getStartingFacilityAge(
        location,
        fuel,
        startingYear,
        reserveName,
      ).ageYears,
    };
  };
  return sizeStartingFleet(
    { ...scenario, startingCustomers: customers, facilities: available },
    (candidate) =>
      forecastCustomGameTimeline(candidate, FLEET_DIFFICULTY, seed),
    reserve,
    (facilities) => allocateCalibratedFleet(facilities, location, startingYear),
  ).map((facility) => ({
    ...facility,
    // A plant is built to two significant digits, so show the size it will have.
    ...(facility.hydroSiteId
      ? {}
      : { peakW: roundToSignificantDigits(facility.peakW || 0, 2) }),
  }));
}
