import type { LocationType } from "../Types";

/** Authored utility program parameters; evidence and limitations are in the companion doc. */
export const THERMAL_FLEXIBILITY = {
  buildoutMonths: 36,
  enrollment: 0.5,
  dispatchFraction: 0.5,
  availability: 0.8,
  peakMinutes: 240,
  recoveryMinutes: 180,
  waterControllerCost: 200,
  heatingControllerCost: 350,
  annualWaterReward: 36,
  annualHeatingReward: 72,
} as const;

export interface ThermalEquipmentProfile {
  /** Fraction of non-weather residential electricity used by storage water heating. */
  hotWaterLoadShare: number;
  /** Equipment ownership, used to size controls and payments, not to multiply load twice. */
  hotWaterCustomerShare: number;
  electricHeatingShare: number;
}

/** Broad equipment envelopes, not measured city-level inventories. Unknown locations deliberately
 * get a small pool. Instantaneous electric showers and gas/district heat are not controllable
 * storage water heaters. See docs/thermal-flexibility-program.md for the research boundary. */
export function thermalEquipmentProfile(
  location: LocationType,
): ThermalEquipmentProfile {
  const { country, admin } = location;
  if (country === "New Zealand")
    return {
      hotWaterLoadShare: 0.25,
      hotWaterCustomerShare: 0.8,
      electricHeatingShare: 0.65,
    };
  if (country === "Australia")
    return {
      hotWaterLoadShare: 0.16,
      hotWaterCustomerShare: 0.5,
      electricHeatingShare: 0.35,
    };
  if (country === "Canada") {
    const quebec = ["QC", "Quebec", "Québec"].includes(admin ?? "");
    return {
      hotWaterLoadShare: quebec ? 0.18 : 0.1,
      hotWaterCustomerShare: quebec ? 0.85 : 0.45,
      electricHeatingShare: quebec ? 0.75 : 0.3,
    };
  }
  if (["Norway", "Sweden", "Finland"].includes(country ?? ""))
    return {
      hotWaterLoadShare: 0.14,
      hotWaterCustomerShare: 0.65,
      electricHeatingShare: country === "Norway" ? 0.8 : 0.45,
    };
  if (country === "France")
    return {
      hotWaterLoadShare: 0.12,
      hotWaterCustomerShare: 0.5,
      electricHeatingShare: 0.35,
    };
  if (["United Kingdom", "Ireland", "Netherlands"].includes(country ?? ""))
    return {
      hotWaterLoadShare: 0.035,
      hotWaterCustomerShare: 0.15,
      electricHeatingShare: 0.08,
    };
  if (country === "United States") {
    const south = [
      "AL",
      "AR",
      "FL",
      "GA",
      "LA",
      "MS",
      "NC",
      "SC",
      "TN",
      "TX",
    ].includes(admin ?? "");
    return {
      hotWaterLoadShare: south ? 0.14 : 0.08,
      hotWaterCustomerShare: south ? 0.6 : 0.35,
      electricHeatingShare: south ? 0.6 : 0.2,
    };
  }
  return {
    hotWaterLoadShare: 0.025,
    hotWaterCustomerShare: 0.08,
    electricHeatingShare: 0.08,
  };
}

/** Relay controls predate connected thermostats by decades. The ramps are conservative game
 * assumptions about deployable program equipment, not forecasts of measured household sales. */
export function waterControlAvailability(year: number): number {
  return Math.max(0, Math.min(1, (year - 1950) / 30));
}

export function smartHeatingAvailability(year: number): number {
  if (year <= 2010) return 0;
  if (year <= 2015) return ((year - 2010) / 5) * 0.15;
  if (year <= 2025) return 0.15 + ((year - 2015) / 10) * 0.5;
  return Math.min(0.9, 0.65 + ((year - 2025) / 10) * 0.25);
}
