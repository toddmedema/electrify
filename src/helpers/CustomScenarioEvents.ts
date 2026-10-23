import { SCENARIOS } from "../data/Scenarios";
import { getStartingCustomers } from "../data/LocationProfiles";
import { inEraMoney } from "../data/FuelPrices";
import { inEraRate } from "../data/RetailRates";
import { ScenarioType } from "../Types";
import { getScenarioLocation } from "./Locations";
import { relocateOfficialArcMonth } from "./ScenarioArcTiming";

export const CUSTOM_EVENT_SCENARIOS = SCENARIOS.filter(
  (scenario) => !scenario.tutorialSteps && scenario.id !== 111,
);

export function validCustomEventIds(value: unknown): boolean {
  return validEventIds(value, CUSTOM_EVENT_SCENARIOS);
}

/** Community snapshots retain all bundled arcs, including already-frozen retired native data. */
export function validOfficialArcIds(value: unknown): boolean {
  return validEventIds(
    value,
    SCENARIOS.filter((scenario) => !scenario.tutorialSteps),
  );
}

function validEventIds(
  value: unknown,
  scenarios: readonly ScenarioType[],
): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= scenarios.length &&
      new Set(value).size === value.length &&
      value.every((id) => scenarios.some((scenario) => scenario.id === id)))
  );
}

export function validCustomEventScenario(scenario?: ScenarioType): boolean {
  return validEventScenario(scenario, !!scenario?.mod);
}

/** Fresh community resolution runs before the validated runtime snapshot has been attached. */
export function validOfficialArcScenario(scenario?: ScenarioType): boolean {
  return validEventScenario(scenario, true);
}

function validEventScenario(
  scenario: ScenarioType | undefined,
  community: boolean,
): boolean {
  if (!scenario) return true;
  if (scenario.id === 999 && scenario.rules !== undefined) return false;
  const positive = (value: unknown) =>
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value > 0);
  return (
    (community ? validOfficialArcIds : validCustomEventIds)(
      scenario.eventScenarioIds,
    ) &&
    (community ||
      (scenario.startingInterties === undefined &&
        scenario.startingIntertieAccess === undefined)) &&
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
      .map((load) => {
        const month = relocateOfficialArcMonth(
          source.id,
          (load.startsYear - source.startingYear) * 12 +
            (load.startsMonth ?? 1) -
            1,
          "load",
        );
        return {
          ...load,
          id: `custom-${source.id}-${load.id}`,
          startsYear: scenario.startingYear + Math.floor(month / 12),
          ...(load.startsMonth === undefined && month % 12 === 0
            ? {}
            : { startsMonth: (month % 12) + 1 }),
          peakW:
            (load.peakW * demand) /
            ((source.startingCustomers ||
              getStartingCustomers(getScenarioLocation(source))) *
              (source.startingDemandScale || 1)),
        };
      }),
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
