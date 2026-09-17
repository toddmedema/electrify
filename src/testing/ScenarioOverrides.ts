import { inEraMoney } from "../data/FuelPrices";
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { getSimLocation, simLocationIds } from "./SimData";

/**
 * Year/location edits need a custom id so initGame does not reload the authored scenario.
 * Scenario money is quoted in its original starting era. The scenario rate also anchors the
 * competitor market, so always convert it even when the player supplies a separate --rate.
 * The simulator applies that explicit player rate at face value after initGame.
 */
export function withScenarioOverrides(
  scenario: ScenarioType,
  { year, locationId }: { year?: number; locationId?: string },
): ScenarioType | undefined {
  if (year === undefined && !locationId) {
    return undefined;
  }
  if (locationId && !getSimLocation(locationId)) {
    throw new Error(
      `Unknown location "${locationId}". Downloaded: ${simLocationIds().join(", ")}`,
    );
  }
  return {
    ...scenario,
    id: CUSTOM_SCENARIO_ID,
    startingYear: year === undefined ? scenario.startingYear : year,
    ...(year !== undefined
      ? {
          cash: inEraMoney(scenario.cash, year, scenario.startingYear),
          dollarsPerkWh: inEraMoney(
            scenario.dollarsPerkWh,
            year,
            scenario.startingYear,
          ),
          feePerKgCO2e: inEraMoney(
            scenario.feePerKgCO2e,
            year,
            scenario.startingYear,
          ),
        }
      : undefined),
    ...(locationId
      ? { locationId, location: getSimLocation(locationId) }
      : undefined),
  };
}
