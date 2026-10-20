import type { LocationType } from "../Types";
import { costBetween } from "../helpers/Math";

/** Evidence and the distinction between observations and game assumptions are documented in
 * docs/customer-battery-program.md. Dollar inputs follow the game's real-cost convention. */
export const CUSTOMER_BATTERIES = {
  buildoutMonths: 48,
  householdPowerW: 5000,
  householdEnergyWh: 10000,
  rebateShare: 0.3,
  reserveShare: 0.2,
  chargeEfficiency: 0.9,
  annualPaymentPerHousehold: 60,
  enrollmentCap: 0.25,
  fullLifeMonths: 120,
  endLifeMonths: 180,
} as const;

/** Addressable hardware market, not existing battery ownership. The VPP opt-in share further
 * limits the systems this program can fund. Both shares freeze at installation. */
export function batteryEligibleHouseholdShare(
  year: number,
  location: Pick<LocationType, "country" | "region">,
): number {
  if (year < 2013) return 0;
  const curve = [
    [2013, 0.0001],
    [2015, 0.0004],
    [2020, 0.003],
    [2025, 0.025],
    [2035, 0.12],
    [2050, 0.25],
  ];
  let share = curve[curve.length - 1][1];
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

/** Installed residential system cost (not cell cost), in real dollars per Wh. IRENA's German
 * 2020 observation is $776/kWh, 71% below 2014; CSIRO's 2024 small system estimate is about
 * US$900/kWh at the stated conversion. Early/future interpolation is a game assumption. */
export function residentialBatteryCostPerWh(year: number): number {
  if (year <= 2020) return costBetween(year, 2014, 2.676, 2020, 0.776);
  if (year <= 2024) return costBetween(year, 2020, 0.776, 2024, 0.9);
  return costBetween(year, 2024, 0.9, 2040, 0.45);
}

/** Access agreements and communications were not mature when the earliest household
 * batteries appeared. This is the share of the addressable hardware market willing and
 * able to sign the VPP agreement at installation, not a second limit on funded assets. */
export function batteryEnrollmentShare(year: number): number {
  if (year < 2016) return 0;
  return Math.min(
    CUSTOMER_BATTERIES.enrollmentCap,
    0.025 + Math.max(0, year - 2016) * 0.045,
  );
}

/** Only systems signed up for VPP access receive this rebate. Existing funded cohorts never
 * gain new households when technology or willingness to enroll improves in a later year. */
export function batteryCohortHouseholds(
  customers: number,
  rolloutShare: number,
  installationYear: number,
  location: Pick<LocationType, "country" | "region">,
): number {
  return (
    Math.max(0, customers) *
    Math.max(0, rolloutShare) *
    batteryEligibleHouseholdShare(installationYear, location) *
    batteryEnrollmentShare(installationYear)
  );
}

/** A fresh funded cohort's utility subsidy. The customer funds the remaining hardware cost. */
export function batteryRebateCost(
  customers: number,
  rolloutShare: number,
  installationYear: number,
  location: Pick<LocationType, "country" | "region">,
): number {
  return (
    batteryCohortHouseholds(
      customers,
      rolloutShare,
      installationYear,
      location,
    ) *
    CUSTOMER_BATTERIES.householdEnergyWh *
    residentialBatteryCostPerWh(installationYear) *
    CUSTOMER_BATTERIES.rebateShare
  );
}
