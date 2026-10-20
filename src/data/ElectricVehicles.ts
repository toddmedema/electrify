import type { LocationType } from "../Types";

type FleetPoint = readonly [year: number, share: number];

const SMART_CHARGING_SHARES: readonly FleetPoint[] = [
  [2010, 0],
  [2015, 0.15],
  [2020, 0.4],
  [2025, 0.7],
  [2035, 0.9],
];

/** Shares of the passenger-car fleet, never shares of new sales. Historical points are
 * rounded calibrations of IEA Global EV Outlook and national vehicle-stock statistics;
 * 2035 onward is a bounded game assumption. See docs/managed-charging-program.md. */
const FLEET_SHARES: Record<string, readonly FleetPoint[]> = {
  world: [
    [2010, 0],
    [2015, 0.001],
    [2020, 0.01],
    [2024, 0.04],
    [2025, 0.05],
    [2035, 0.24],
    [2050, 0.6],
    [2070, 0.8],
  ],
  "North America": [
    [2010, 0],
    [2015, 0.002],
    [2020, 0.007],
    [2024, 0.025],
    [2025, 0.03],
    [2035, 0.22],
    [2050, 0.6],
    [2070, 0.8],
  ],
  Europe: [
    [2010, 0],
    [2015, 0.002],
    [2020, 0.014],
    [2024, 0.05],
    [2025, 0.05],
    [2035, 0.35],
    [2050, 0.75],
    [2070, 0.9],
  ],
  China: [
    [2010, 0],
    [2015, 0.003],
    [2020, 0.02],
    [2024, 0.1],
    [2025, 0.13],
    [2035, 0.5],
    [2050, 0.85],
    [2070, 0.95],
  ],
  Norway: [
    [2010, 0],
    [2015, 0.027],
    [2020, 0.18],
    [2024, 0.35],
    [2025, 0.39],
    [2035, 0.8],
    [2050, 0.95],
    [2070, 0.95],
  ],
  Oceania: [
    [2010, 0],
    [2015, 0.0008],
    [2020, 0.003],
    [2024, 0.02],
    [2025, 0.027],
    [2035, 0.25],
    [2050, 0.65],
    [2070, 0.85],
  ],
  emerging: [
    [2010, 0],
    [2015, 0.0001],
    [2020, 0.001],
    [2024, 0.005],
    [2025, 0.008],
    [2035, 0.1],
    [2050, 0.4],
    [2070, 0.7],
  ],
};

export const MANAGED_CHARGING = {
  enrollmentMonths: 12,
  maxEnrollment: 0.5,
  // Shift found customers accepted smart charging in 85% of sessions. An additional
  // 50% cap avoids claiming its full unmanaged-peak benefit over our overnight baseline.
  overrideShare: 0.15,
  incrementalShiftShare: 0.5,
  recoveryMinutes: 360,
  peakMinutes: 240,
  annualCreditPerVehicle: 72,
  annualAdminPerVehicle: 18,
  vehiclesPerCustomer: 0.8,
  dailyChargingWhPerVehicle: 6000,
  maxRoadChargingShare: 0.75,
  railEquivalentFleetShare: 0.03,
} as const;

function interpolate(points: readonly FleetPoint[], year: number): number {
  if (year <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [endYear, endShare] = points[i];
    const [startYear, startShare] = points[i - 1];
    if (year <= endYear)
      return (
        startShare +
        ((year - startYear) / (endYear - startYear)) * (endShare - startShare)
      );
  }
  return points[points.length - 1][1];
}

function fleetProfile(location?: LocationType): readonly FleetPoint[] {
  const country = location?.country?.toLowerCase();
  if (country === "norway" || country === "no") return FLEET_SHARES.Norway;
  if (country === "china" || country === "cn") return FLEET_SHARES.China;
  // Country identity wins when a custom location has no continent metadata.
  if (
    [
      "united states",
      "united states of america",
      "us",
      "canada",
      "ca",
    ].includes(country ?? "")
  )
    return FLEET_SHARES["North America"];
  if (["australia", "au", "new zealand", "nz"].includes(country ?? ""))
    return FLEET_SHARES.Oceania;
  if (
    [
      "united kingdom",
      "gb",
      "uk",
      "france",
      "germany",
      "sweden",
      "netherlands",
    ].includes(country ?? "")
  )
    return FLEET_SHARES.Europe;
  if (
    location?.region === "North America" ||
    location?.region === "Europe" ||
    location?.region === "Oceania"
  )
    return FLEET_SHARES[location.region];
  if (location?.region) return FLEET_SHARES.emerging;
  return FLEET_SHARES.world;
}

/** Historical electric rail is deliberately ineligible. Modern plug-in cars start at zero
 * in 2010; charger/vehicle control capability develops separately from fleet turnover. */
export function electricVehicleEligibility(
  year: number,
  location?: LocationType,
) {
  const fleetShare =
    Number.isFinite(year) && year > 2010
      ? interpolate(fleetProfile(location), year)
      : 0;
  const smartChargingShare =
    fleetShare > 0 ? interpolate(SMART_CHARGING_SHARES, year) : 0;
  const eligibleTransportationShare =
    fleetShare > 0
      ? (MANAGED_CHARGING.maxRoadChargingShare * fleetShare) /
        (fleetShare + MANAGED_CHARGING.railEquivalentFleetShare)
      : 0;
  return { fleetShare, smartChargingShare, eligibleTransportationShare };
}

/** Enrollment is the actual fraction of compatible vehicles signed up, including ramp-up.
 * Credits/admin are annual real 2025 dollars; the policy owner applies inflation/month scaling. */
export function managedChargingParticipants(
  customers: number,
  year: number,
  location?: LocationType,
  enrollment: number = MANAGED_CHARGING.maxEnrollment,
  representedTransportationW?: number,
) {
  const { fleetShare, smartChargingShare, eligibleTransportationShare } =
    electricVehicleEligibility(year, location);
  const stockVehicles =
    Math.max(0, customers) * MANAGED_CHARGING.vehiclesPerCustomer * fleetShare;
  // The game's transport sector can represent less EV energy than the full real-world fleet.
  // Never pay incentives for vehicles whose charging is absent from that electricity demand.
  const representedVehicles =
    representedTransportationW === undefined
      ? stockVehicles
      : (Math.max(0, representedTransportationW) *
          eligibleTransportationShare) /
        (MANAGED_CHARGING.dailyChargingWhPerVehicle / 24);
  return (
    Math.min(stockVehicles, representedVehicles) *
    smartChargingShare *
    Math.max(0, Math.min(MANAGED_CHARGING.maxEnrollment, enrollment))
  );
}

export function managedChargingAnnualCost(
  customers: number,
  year: number,
  location?: LocationType,
  enrollment: number = MANAGED_CHARGING.maxEnrollment,
  representedTransportationW?: number,
): number {
  return (
    managedChargingParticipants(
      customers,
      year,
      location,
      enrollment,
      representedTransportationW,
    ) *
    (MANAGED_CHARGING.annualCreditPerVehicle +
      MANAGED_CHARGING.annualAdminPerVehicle)
  );
}
