import { SCENARIOS } from "../data/Scenarios";
import { getStartingCustomers } from "../data/LocationProfiles";
import { inEraMoney } from "../data/FuelPrices";
import { inEraRate } from "../data/RetailRates";
import { ScenarioType } from "../Types";
import { getScenarioLocation } from "./Locations";

export const CUSTOM_EVENT_SCENARIOS = SCENARIOS.filter(
  (scenario) => !scenario.tutorialSteps,
);

export function validCustomEventIds(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= CUSTOM_EVENT_SCENARIOS.length &&
      new Set(value).size === value.length &&
      value.every((id) =>
        CUSTOM_EVENT_SCENARIOS.some((scenario) => scenario.id === id),
      ))
  );
}

export function validCustomEventScenario(scenario?: ScenarioType): boolean {
  if (!scenario) return true;
  const positive = (value: unknown) =>
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value > 0);
  return (
    validCustomEventIds(scenario.eventScenarioIds) &&
    Number.isInteger(scenario.startingYear) &&
    scenario.startingYear >= 1980 &&
    scenario.startingYear <= 2100 &&
    positive(scenario.startingCustomers) &&
    positive(scenario.startingDemandScale) &&
    Number.isFinite(
      (scenario.startingCustomers || 1) * (scenario.startingDemandScale || 1),
    )
  );
}

/** Grid size, rather than the source city's population, sets an imported event's budget. */
export function customEventContext(scenario?: ScenarioType) {
  if (!scenario || scenario.id !== 999) return undefined;
  const demand =
    (scenario.startingCustomers ||
      getStartingCustomers(getScenarioLocation(scenario))) *
    (scenario.startingDemandScale || 1);
  return CUSTOM_EVENT_SCENARIOS.filter((source) =>
    scenario.eventScenarioIds?.includes(source.id),
  ).map((source) => ({
    scenarioId: source.id,
    moneyScale:
      (demand /
        ((source.startingCustomers ||
          getStartingCustomers(getScenarioLocation(source))) *
          (source.startingDemandScale || 1))) *
      inEraMoney(1, scenario.startingYear, source.startingYear),
  }));
}

export function standardCustomRate(scenario: ScenarioType): number {
  const source = CUSTOM_EVENT_SCENARIOS.find(
    (candidate) => candidate.locationId === scenario.locationId,
  );
  return source
    ? inEraRate(
        source.dollarsPerkWh,
        scenario.startingYear,
        source.startingYear,
      )
    : inEraRate(0.07, scenario.startingYear);
}

/** Absolute campus/mine loads scale with the receiving grid and retain the source lead time. */
export function prepareCustomScenario(scenario: ScenarioType): ScenarioType {
  const demand =
    (scenario.startingCustomers ||
      getStartingCustomers(getScenarioLocation(scenario))) *
    (scenario.startingDemandScale || 1);
  const sources = CUSTOM_EVENT_SCENARIOS.filter((source) =>
    scenario.eventScenarioIds?.includes(source.id),
  );
  const additions = sources.flatMap((source) =>
    (source.loadAdditions || [])
      .filter(
        (load) =>
          load.startsYear > source.startingYear ||
          (load.startsYear === source.startingYear &&
            (load.startsMonth || 1) > 1),
      )
      .map((load) => ({
        ...load,
        id: `custom-${source.id}-${load.id}`,
        startsYear:
          scenario.startingYear +
          Math.max(3, load.startsYear - source.startingYear),
        peakW:
          (load.peakW * demand) /
          ((source.startingCustomers ||
            getStartingCustomers(getScenarioLocation(source))) *
            (source.startingDemandScale || 1)),
      })),
  );
  return {
    ...scenario,
    dollarsPerkWh: standardCustomRate(scenario),
    loadAdditions: additions,
    durationMonths: Math.max(
      scenario.durationMonths,
      ...sources.map((source) => source.durationMonths),
    ),
  };
}
