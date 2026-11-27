import { SCENARIOS } from "../data/Scenarios";
import { getStartingCustomers } from "../data/LocationProfiles";
import { inEraRate } from "../data/RetailRates";
import { ScenarioType } from "../Types";
import { getScenarioLocation } from "./Locations";
import { relocateOfficialArcMonth } from "./ScenarioArcTiming";

const OFFICIAL_ARCS = SCENARIOS.filter((scenario) => !scenario.tutorialSteps);

/** Community packages can select every current official arc. */
export function validOfficialArcIds(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= OFFICIAL_ARCS.length &&
      new Set(value).size === value.length &&
      value.every((id) => OFFICIAL_ARCS.some((scenario) => scenario.id === id)))
  );
}

/** A saved game's setup. A modded game's arcs are checked against the official catalog. */
export function validSavedCustomScenario(scenario?: ScenarioType): boolean {
  return validScenario(scenario, !!scenario?.mod);
}

/** Fresh community resolution runs before the validated runtime snapshot has been attached. */
export function validOfficialArcScenario(scenario?: ScenarioType): boolean {
  return validScenario(scenario, true);
}

function validScenario(
  scenario: ScenarioType | undefined,
  community: boolean,
): boolean {
  if (!scenario) return true;
  if (scenario.id === 999 && scenario.rules !== undefined) return false;
  const positive = (value: unknown) =>
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value > 0);
  return (
    // Only a community package can carry official arcs; a custom game has no scenario events.
    (community
      ? validOfficialArcIds(scenario.eventScenarioIds)
      : !scenario.eventScenarioIds?.length) &&
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

/**
 * The opening rate is automatic: an official location's authored tariff when there is one, or the
 * custom-game default, either way re-quoted through the retail-rate index for the starting year.
 */
export function standardCustomRate(scenario: ScenarioType): number {
  const source = SCENARIOS.find(
    (candidate) =>
      !candidate.tutorialSteps &&
      candidate.id !== 111 &&
      candidate.locationId === scenario.locationId,
  );
  return source
    ? inEraRate(
        source.dollarsPerkWh,
        scenario.startingYear,
        source.startingYear,
      )
    : inEraRate(0.07, scenario.startingYear);
}

/**
 * What the custom setup screen shows for a stored or shared setup: the automatic opening rate,
 * and none of the scenario events or event-derived loads that older setups could carry.
 */
export function prepareCustomSetup(scenario: ScenarioType): ScenarioType {
  const {
    eventScenarioIds: _events,
    loadAdditions: _loads,
    ...setup
  } = scenario;
  return { ...setup, dollarsPerkWh: standardCustomRate(scenario) };
}

/** Wildfire Emergency depends on its authored starting intertie, so its loads and term are not imported. */
const IMPORTED_ARC_SOURCES = OFFICIAL_ARCS.filter(
  (scenario) => scenario.id !== 111,
);

/** Absolute campus/mine loads scale with the receiving grid and retain the source lead time. */
export function prepareOfficialArcScenario(
  scenario: ScenarioType,
): ScenarioType {
  const demand =
    (scenario.startingCustomers ||
      getStartingCustomers(getScenarioLocation(scenario))) *
    (scenario.startingDemandScale || 1);
  const sources = IMPORTED_ARC_SOURCES.filter((source) =>
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
