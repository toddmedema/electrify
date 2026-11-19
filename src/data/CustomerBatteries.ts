import type { LocationType } from "../Types";

/** Evidence and the distinction between observations and game assumptions are documented in
 * docs/customer-battery-program.md. Dollar inputs follow the game's real-cost convention. */
export const CUSTOMER_BATTERIES = {
  buildoutMonths: 12,
  offerFromYear: 2022,
  peakWindowHours: 4,
  householdPowerW: 5000,
  householdEnergyWh: 10000,
  reserveShare: 0.2,
  chargeEfficiency: 0.9,
  annualPaymentPerKw: 45,
  maximumChargingCostPerMWh: 65,
  chargingReserveShare: 0.05,
  enrollmentCap: 0.25,
  fullLifeMonths: 120,
  endLifeMonths: 180,
} as const;

const ELIGIBLE_HOUSEHOLD_SHARES = [
  [2013, 0.0001],
  [2015, 0.0004],
  [2020, 0.003],
  [2025, 0.025],
  [2035, 0.12],
  [2050, 0.25],
] as const;

/** Estimated share of households with an existing compatible battery. The opt-in share
 * further limits the devices enrolled in each cohort. */
export function batteryEligibleHouseholdShare(
  year: number,
  location: Pick<LocationType, "country" | "region">,
): number {
  if (year < 2013) return 0;
  const curve = ELIGIBLE_HOUSEHOLD_SHARES;
  let share: number = curve[curve.length - 1][1];
  for (let i = 1; i < curve.length; i++) {
    const [endYear, endShare] = curve[i];
    if (year <= endYear) {
      const [startYear, startShare] = curve[i - 1];
      share =
        startShare +
        ((endShare - startShare) * (year - startYear)) / (endYear - startYear);
      break;
    }
  }
  // These are bounded readiness assumptions, not national battery ownership forecasts.
  const country = location.country;
  const maturity = Math.min(1, Math.max(0, (year - 2015) / 10));
  const earlyReadiness =
    country === "Germany"
      ? 2
      : country === "Australia"
        ? 0.5
        : country === "Japan"
          ? 1.5
          : country === "India"
            ? 0.3
            : country === "Zambia"
              ? 0.15
              : country === "South Africa"
                ? 0.5
                : location.region === "Africa" ||
                    location.region === "South Asia"
                  ? 0.4
                  : 1;
  const lateReadiness =
    country === "Germany"
      ? 1.5
      : country === "Australia"
        ? 2
        : country === "South Africa"
          ? 1.2
          : earlyReadiness;
  const readiness =
    earlyReadiness + (lateReadiness - earlyReadiness) * maturity;
  return Math.min(0.3, Math.max(0, share * readiness));
}

export const homeBatteryProgramAvailable = (year: number) =>
  year >= CUSTOMER_BATTERIES.offerFromYear;

/** Access agreements and communications were not mature when the earliest household
 * batteries appeared. This is the share of existing owners willing and able to sign a VPP
 * agreement. */
export function batteryEnrollmentShare(year: number): number {
  if (year < 2016) return 0;
  return Math.min(
    CUSTOMER_BATTERIES.enrollmentCap,
    0.025 + Math.max(0, year - 2016) * 0.045,
  );
}

/** The contracted fleet grows as existing batteries enroll. Completed cohorts retain the
 * household count they signed up with. */
export function batteryCohortHouseholds(
  customers: number,
  rolloutShare: number,
  enrollmentYear: number,
  location: Pick<LocationType, "country" | "region">,
): number {
  return (
    Math.max(0, customers) *
    Math.max(0, rolloutShare) *
    batteryEligibleHouseholdShare(enrollmentYear, location) *
    batteryEnrollmentShare(enrollmentYear)
  );
}
