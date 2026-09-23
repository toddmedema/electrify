import { WildfireProfileType } from "../Types";

/**
 * Authored regional wildfire hazards for recurring, location-aware emergencies.
 *
 * Only reviewed service areas ship a profile; every other location -- including unknown or custom
 * coordinates -- carries no inferred risk. The values are deliberately simplified game balance,
 * not observed fire statistics: the monthly weights shape a seasonal risk that is never a
 * guaranteed destructive fire, and the severity bounds are the readable range an incident may land
 * in. See issue #62 for the design and its explicit non-claims (no drought inference from sampled
 * city days, no geographically accurate plant exposure).
 */

// Southern California: a summer-fall fire season with a secondary winter wind-event window (the
// Santa Ana period that drives the authored January lesson in scenario 111). Weights sum to one.
const LOS_ANGELES: WildfireProfileType = {
  annualHazard: 0.4,
  monthlyWeights: [
    0.12, // Jan - winter wind events
    0.08, // Feb
    0.04, // Mar
    0.03, // Apr
    0.05, // May
    0.07, // Jun
    0.12, // Jul
    0.13, // Aug
    0.14, // Sep - peak
    0.12, // Oct
    0.08, // Nov
    0.02, // Dec
  ],
  disconnectedDemand: { min: 0.02, max: 0.1 },
  outputMultiplier: { min: 0.25, max: 0.65 },
  targetCapacityShare: { min: 0.3, max: 0.7 },
  restorationCostPerMWh: 5,
  cooldownMonths: 6,
  // Offered in August, ahead of the peak season, so a funded response is in place before any
  // September-onward ignition -- including the winter wind events -- rather than racing a fire.
  preparednessMonth: 7,
  preparednessDurationMonths: 7, // August through February
};

// Northern California service area: a similar summer-fall season, slightly lower baseline hazard.
const SAN_FRANCISCO: WildfireProfileType = {
  annualHazard: 0.3,
  monthlyWeights: [
    0.1, // Jan - winter wind events
    0.07, // Feb
    0.04, // Mar
    0.03, // Apr
    0.05, // May
    0.08, // Jun
    0.13, // Jul
    0.14, // Aug
    0.15, // Sep - peak
    0.12, // Oct
    0.07, // Nov
    0.02, // Dec
  ],
  disconnectedDemand: { min: 0.02, max: 0.08 },
  outputMultiplier: { min: 0.3, max: 0.65 },
  targetCapacityShare: { min: 0.3, max: 0.6 },
  restorationCostPerMWh: 5,
  cooldownMonths: 6,
  preparednessMonth: 7, // August, ahead of the peak season
  preparednessDurationMonths: 6, // August through January
};

const PROFILES_BY_LOCATION_ID: Record<string, WildfireProfileType> = {
  LA: LOS_ANGELES,
  SF: SAN_FRANCISCO,
};

/** The authored hazard for a location id, or undefined when the area carries no profile. */
export function getWildfireProfile(
  locationId?: string,
): WildfireProfileType | undefined {
  return locationId ? PROFILES_BY_LOCATION_ID[locationId] : undefined;
}

/** Every authored profile, for validation and balance tooling. */
export function allWildfireProfiles(): WildfireProfileType[] {
  return Object.values(PROFILES_BY_LOCATION_ID);
}

/**
 * Structural validation for an authored profile. Throws on the first problem so a bad data file
 * fails loudly at load and in tests rather than silently producing a degenerate hazard.
 */
export function validateWildfireProfile(
  profile: WildfireProfileType,
  label = "profile",
): void {
  const problems: string[] = [];
  if (!Number.isFinite(profile.annualHazard) || profile.annualHazard < 0) {
    problems.push(`${label}.annualHazard must be a finite non-negative number`);
  }
  if (profile.monthlyWeights.length !== 12) {
    problems.push(`${label}.monthlyWeights must have exactly twelve entries`);
  } else {
    const sum = profile.monthlyWeights.reduce(
      (total, weight) => total + weight,
      0,
    );
    if (
      profile.monthlyWeights.some(
        (weight) => !Number.isFinite(weight) || weight < 0,
      )
    ) {
      problems.push(`${label}.monthlyWeights must be finite and non-negative`);
    } else if (Math.abs(sum - 1) > 1e-6) {
      problems.push(`${label}.monthlyWeights must sum to one (got ${sum})`);
    }
  }
  const bounds: Array<[string, { min: number; max: number }, number, number]> =
    [
      ["disconnectedDemand", profile.disconnectedDemand, 0, 1],
      ["outputMultiplier", profile.outputMultiplier, 0, 1],
      ["targetCapacityShare", profile.targetCapacityShare, 0, 1],
    ];
  bounds.forEach(([name, bound, lo, hi]) => {
    if (
      !Number.isFinite(bound.min) ||
      !Number.isFinite(bound.max) ||
      bound.min < lo ||
      bound.max > hi ||
      bound.min > bound.max
    ) {
      problems.push(
        `${label}.${name} must be within [${lo}, ${hi}] with min <= max`,
      );
    }
  });
  if (
    !Number.isFinite(profile.restorationCostPerMWh) ||
    profile.restorationCostPerMWh < 0
  ) {
    problems.push(
      `${label}.restorationCostPerMWh must be a finite non-negative number`,
    );
  }
  if (!Number.isInteger(profile.cooldownMonths) || profile.cooldownMonths < 0) {
    problems.push(`${label}.cooldownMonths must be a non-negative integer`);
  }
  if (
    !Number.isInteger(profile.preparednessMonth) ||
    profile.preparednessMonth < 0 ||
    profile.preparednessMonth > 11
  ) {
    problems.push(`${label}.preparednessMonth must be an integer month index`);
  }
  if (
    !Number.isInteger(profile.preparednessDurationMonths) ||
    profile.preparednessDurationMonths <= 0
  ) {
    problems.push(
      `${label}.preparednessDurationMonths must be a positive integer`,
    );
  }
  if (problems.length) {
    throw new Error(`Invalid wildfire profile:\n${problems.join("\n")}`);
  }
}

// Validate the shipped profiles at module load so a regression in this data file cannot ship.
allWildfireProfiles().forEach((profile, index) =>
  validateWildfireProfile(profile, `profiles[${index}]`),
);
