import { WildfireProfileType } from "../Types";
import smokeHistory from "./WildfireSmokeHistory.json";

/**
 * Reviewed city-point smoke histories, not a fire ignition or equipment failure model.
 * Occurrence resamples entire NOAA HMS years; severity transfers a separately sourced
 * NREL regional heavy-smoke reference. See docs/wildfire-calibration-evidence.md.
 */
const PROFILES_BY_LOCATION_ID: Record<string, WildfireProfileType> =
  Object.fromEntries(
    (["LA", "SF"] as const).map((locationId) => [
      locationId,
      {
        locationId,
        sourceYears: smokeHistory.years.map((year) => year.year),
        dailyReferenceAttenuation:
          smokeHistory.attenuationReference.dailyIrradianceLoss[locationId],
        localStartHour: smokeHistory.attenuationReference.localStartHour,
        localEndHour: smokeHistory.attenuationReference.localEndHour,
      },
    ]),
  );

/** Only reviewed locations have a smoke exposure model. */
export function getWildfireProfile(
  locationId?: string,
): WildfireProfileType | undefined {
  return locationId ? PROFILES_BY_LOCATION_ID[locationId] : undefined;
}

export function allWildfireProfiles(): WildfireProfileType[] {
  return Object.values(PROFILES_BY_LOCATION_ID);
}

/** Reject unsupported exposure, missing source years, and invalid attenuation windows. */
export function validateWildfireProfile(
  profile: WildfireProfileType,
  label = "profile",
): void {
  const problems: string[] = [];
  if (profile.locationId !== "LA" && profile.locationId !== "SF") {
    problems.push(`${label}.locationId must have reviewed LA/SF evidence`);
  }
  if (
    !profile.sourceYears.length ||
    new Set(profile.sourceYears).size !== profile.sourceYears.length ||
    profile.sourceYears.some(
      (year) =>
        !Number.isInteger(year) ||
        !smokeHistory.years.some((source) => source.year === year),
    )
  ) {
    problems.push(
      `${label}.sourceYears must name unique years in the catalogue`,
    );
  }
  if (
    !profile.dailyReferenceAttenuation.length ||
    profile.dailyReferenceAttenuation.some(
      (loss) => !Number.isFinite(loss) || loss < 0 || loss > 1,
    )
  ) {
    problems.push(
      `${label}.dailyReferenceAttenuation must contain ratios in [0, 1]`,
    );
  }
  if (
    !Number.isInteger(profile.localStartHour) ||
    !Number.isInteger(profile.localEndHour) ||
    profile.localStartHour < 0 ||
    profile.localEndHour > 24 ||
    profile.localStartHour >= profile.localEndHour
  ) {
    problems.push(
      `${label} must have a positive local sampling-hour window within [0, 24]`,
    );
  }
  if (problems.length) {
    throw new Error(`Invalid wildfire profile:\n${problems.join("\n")}`);
  }
}

allWildfireProfiles().forEach((profile, index) =>
  validateWildfireProfile(profile, `profiles[${index}]`),
);
