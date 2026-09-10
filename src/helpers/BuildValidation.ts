import { FacilityShoppingType } from "../Types";

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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
    ].some(
      (key) => facility[key] !== undefined && !nonNegative(facility[key]),
    ) ||
    ["annualOutputDegradation", "minimumStableOutput"].some(
      (key) => typeof facility[key] === "number" && facility[key] > 1,
    ) ||
    (facility.tracksStarts !== undefined &&
      typeof facility.tracksStarts !== "boolean")
  )
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
