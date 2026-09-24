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
];

/**
 * A quote's weather hardening: booleans and a bounded design temperature, each only on the
 * technology it applies to, so a crafted replay cannot harden the wrong plant.
 */
function validResilience(facility: Record<string, unknown>): boolean {
  if (
    facility.resilienceExtraBuildCost !== undefined &&
    (!nonNegative(facility.resilienceExtraBuildCost) ||
      facility.resilienceExtraBuildCost > (facility.buildCost as number))
  )
    return false;
  if (facility.resilience === undefined) return true;
  if (!facility.resilience || typeof facility.resilience !== "object")
    return false;
  const resilience = facility.resilience as Record<string, unknown>;
  const allowed =
    facility.fuel === "Sun"
      ? ["hailResistant"]
      : facility.fuel === "Natural Gas"
        ? ["coldWeatherPackage", "designMinTempC"]
        : [];
  const keys = Object.keys(resilience);
  if (keys.some((key) => !allowed.includes(key))) return false;
  if (
    ["hailResistant", "coldWeatherPackage"].some(
      (key) =>
        resilience[key] !== undefined && typeof resilience[key] !== "boolean",
    )
  )
    return false;
  const designMinTempC = resilience.designMinTempC;
  return (
    designMinTempC === undefined ||
    (typeof designMinTempC === "number" &&
      Number.isFinite(designMinTempC) &&
      designMinTempC >= DESIGN_MIN_TEMP_BOUNDS_C.min &&
      designMinTempC <= DESIGN_MIN_TEMP_BOUNDS_C.max)
  );
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
