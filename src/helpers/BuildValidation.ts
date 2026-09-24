import {
  FacilityShoppingType,
  ResilienceUpgradeType,
  RetrofitFacilityAction,
} from "../Types";
import { DESIGN_MIN_TEMP_BOUNDS_C } from "../data/Hazards";

const MAXIMUM_CONSTRUCTION_KGCO2E: Readonly<Record<string, number>> = {
  constructionKgco2ePerW: 20,
  constructionKgco2ePerWh: 1,
};

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const RESILIENCE_UPGRADES: readonly ResilienceUpgradeType[] = [
  "hailResistant",
  "coldWeatherPackage",
  "solarTrackers",
];

const RESILIENCE_FIELDS_BY_FUEL: Readonly<Record<string, readonly string[]>> = {
  Sun: ["hailResistant", "solarTrackers", "trackerHailDamageFactor"],
  "Natural Gas": ["coldWeatherPackage", "designMinTempC"],
};

/**
 * Weather hardening on a quote or a saved facility: known flags only, each on the technology it
 * applies to, with a bounded gas design temperature and tracker hail share, so a crafted replay
 * or edited save cannot harden a plant it does not describe.
 */
export function validResilienceRecord(fuel: unknown, raw: unknown): boolean {
  if (raw === undefined) return true;
  if (!raw || typeof raw !== "object") return false;
  const allowed = RESILIENCE_FIELDS_BY_FUEL[String(fuel)] ?? [];
  return Object.entries(raw as Record<string, unknown>).every(
    ([key, value]) => {
      if (!allowed.includes(key)) return false;
      if (value === undefined) return true;
      if (key === "designMinTempC") {
        return (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= DESIGN_MIN_TEMP_BOUNDS_C.min &&
          value <= DESIGN_MIN_TEMP_BOUNDS_C.max
        );
      }
      if (key === "trackerHailDamageFactor") {
        return (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > 0 &&
          value <= 1
        );
      }
      return typeof value === "boolean";
    },
  );
}

/** A saved retrofit in progress: a known upgrade, a non-negative price and an ordered window. */
export function validUpgradeInProgress(raw: unknown): boolean {
  if (raw === undefined) return true;
  if (!raw || typeof raw !== "object") return false;
  const upgrade = raw as Record<string, unknown>;
  return (
    RESILIENCE_UPGRADES.includes(upgrade.upgrade as ResilienceUpgradeType) &&
    nonNegative(upgrade.cost) &&
    nonNegative(upgrade.startsMinute) &&
    nonNegative(upgrade.completesMinute) &&
    (upgrade.completesMinute as number) >= (upgrade.startsMinute as number)
  );
}

/** A quote's weather hardening and the share of its price the options account for. */
function validResilience(facility: Record<string, unknown>): boolean {
  if (
    facility.resilienceExtraBuildCost !== undefined &&
    (!nonNegative(facility.resilienceExtraBuildCost) ||
      facility.resilienceExtraBuildCost > (facility.buildCost as number))
  )
    return false;
  return validResilienceRecord(facility.fuel, facility.resilience);
}

/** Retrofit requests also arrive through untrusted replay documents. */
export function validRetrofitFacility(
  raw: unknown,
): raw is RetrofitFacilityAction {
  if (!raw || typeof raw !== "object") return false;
  const payload = raw as Record<string, unknown>;
  return (
    Number.isSafeInteger(payload.facilityId) &&
    (payload.facilityId as number) >= 0 &&
    RESILIENCE_UPGRADES.includes(payload.upgrade as ResilienceUpgradeType)
  );
}

/** Shopping quotes travel through untrusted replay documents as well as the build dialog. */
export function validBuildFacility(raw: unknown): raw is {
  facility: FacilityShoppingType;
  financed: boolean;
} {
  if (!raw || typeof raw !== "object") return false;
  const payload = raw as Record<string, unknown>;
  if (typeof payload.financed !== "boolean") return false;
  if (!payload.facility || typeof payload.facility !== "object") return false;
  const facility = payload.facility as Record<string, unknown>;
  if (
    typeof facility.name !== "string" ||
    !facility.name.length ||
    typeof facility.description !== "string" ||
    typeof facility.available !== "boolean" ||
    ![
      "buildCost",
      "annualOperatingCost",
      "peakW",
      "lifespanYears",
      "yearsToBuild",
    ].every((key) => nonNegative(facility[key])) ||
    facility.peakW === 0 ||
    facility.lifespanYears === 0 ||
    [
      "annualOutputDegradation",
      "minimumStableOutput",
      "costPerStart",
      "variableOperatingCostPerMWh",
      "reservoirCapacityWh",
      "hydroWhPerMm",
      "hydroMeanMonthlyInflowWh",
      "viableLocationsRemaining",
      "constructionKgco2ePerW",
      "constructionKgco2ePerWh",
    ].some(
      (key) => facility[key] !== undefined && !nonNegative(facility[key]),
    ) ||
    ["annualOutputDegradation", "minimumStableOutput"].some(
      (key) => typeof facility[key] === "number" && facility[key] > 1,
    ) ||
    (facility.tracksStarts !== undefined &&
      typeof facility.tracksStarts !== "boolean") ||
    // Bounded as well as non-negative. These travel through replay documents and go straight
    // into the run's emissions and score, so an unbounded value from a crafted quote would
    // poison both. The ceilings sit an order of magnitude above the dirtiest thing buildable
    // (hydro at 2 kgCO2e/W, batteries at 0.08 kgCO2e/Wh), which leaves plenty of headroom for
    // any future technology without letting an arbitrary number through.
    ["constructionKgco2ePerW", "constructionKgco2ePerWh"].some(
      (key) =>
        typeof facility[key] === "number" &&
        facility[key] > MAXIMUM_CONSTRUCTION_KGCO2E[key],
    ) ||
    !validResilience(facility)
  )
    return false;
  if (
    (facility.name === "Hydro" || facility.fuel === "Hydro") &&
    (facility.name !== "Hydro" ||
      facility.fuel !== "Hydro" ||
      facility.peakWh !== undefined ||
      !Number.isSafeInteger(facility.peakW))
  )
    return false;
  if (facility.name !== "Hydro" && facility.hydroSiteId !== undefined)
    return false;
  if (facility.peakWh !== undefined) {
    return (
      ["peakWh", "maxPeakWh", "roundTripEfficiency", "hourlyLoss"].every(
        (key) => nonNegative(facility[key]),
      ) &&
      (facility.peakWh as number) > 0 &&
      (facility.maxPeakWh as number) > 0 &&
      (facility.roundTripEfficiency as number) > 0 &&
      (facility.roundTripEfficiency as number) <= 1 &&
      (facility.hourlyLoss as number) <= 1
    );
  }
  return (
    [
      "Coal",
      "Biomass",
      "Wind",
      "Offshore Wind",
      "Airborne Wind",
      "Sun",
      "Natural Gas",
      "Uranium",
      "Oil",
      "Geothermal",
      "Hydro",
    ].includes(facility.fuel as string) &&
    ["maxPeakW", "capacityFactor", "spinMinutes", "btuPerWh"].every((key) =>
      nonNegative(facility[key]),
    ) &&
    (facility.maxPeakW as number) > 0 &&
    (facility.capacityFactor as number) <= 1 &&
    (facility.spinMinutes as number) > 0
  );
}
