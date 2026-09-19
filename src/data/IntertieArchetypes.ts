/**
 * What kind of grid sits on the far end of an intertie. Each neighbouring market is assigned one
 * archetype, which decides when it can spare power and what that power costs. These are calibrated
 * gameplay abstractions of the researched market descriptions, not hourly historical reconstructions.
 *
 * Monthly shapes are written for the northern hemisphere and shift six months for southern cities.
 * Availability is a share of the line's weather-adjusted rating the neighbour can fill; the market's
 * absolute `availableSupplyW` still caps it.
 */

export type IntertieArchetypeIdType =
  | "SEASONAL_HYDRO"
  | "RESERVOIR_HYDRO"
  | "SOLAR_HEAVY"
  | "WIND_HEAVY"
  | "PEAK_SHARING"
  | "LARGE_POOL"
  | "FIRM_THERMAL";

export interface IntertieArchetypeType {
  id: IntertieArchetypeIdType;
  /** Short chip label shown on intertie cards */
  label: string;
  /** One plain sentence: when this neighbour helps and when it does not */
  summary: string;
  /** Jan..Dec (northern hemisphere), 0..1 share of the line the neighbour can typically fill */
  monthlyAvailability: readonly number[];
  /** Hour 0..23, multiplies the monthly share */
  hourlyAvailability: readonly number[];
  /**
   * Share of availability lost at full local heat or cold stress. `null` means the neighbour
   * shares your peaks, so the loss comes from the difficulty's `peakSharingImportLoss` instead.
   */
  heatStressLoss: number | null;
  coldStressLoss: number | null;
  /** Standard deviation of a seeded whole-year factor (dry water years), 0 for none */
  yearlyVariability: number;
  /** Chance each simulated day (one per game month) is a calm spell, and the share left if so */
  lullChance: number;
  lullAvailability: number;
  /** $/MWh added to the market's base price by hour 0..23 */
  hourlyPriceOffset: readonly number[];
  /** $/MWh added by month Jan..Dec (northern hemisphere) */
  monthlyPriceOffset: readonly number[];
  /** $/MWh added at full local heat or cold stress */
  heatStressPremium: number;
  coldStressPremium: number;
  /** $/MWh added per unit of lost yearly or lull availability, eg a dry year or a calm day */
  scarcityPremium: number;
  /** Standard deviation of seeded per-tick price noise, $/MWh */
  priceNoise: number;
}

function hours(
  fill: number,
  ...ranges: [from: number, to: number, value: number][]
): number[] {
  const result = new Array(24).fill(fill);
  for (const [from, to, value] of ranges) {
    for (let h = from; h < to; h++) result[h] = value;
  }
  return result;
}

const FLAT_MONTHS = new Array(12).fill(0);

export const INTERTIE_ARCHETYPES: Readonly<
  Record<IntertieArchetypeIdType, IntertieArchetypeType>
> = {
  SEASONAL_HYDRO: {
    id: "SEASONAL_HYDRO",
    label: "Seasonal hydro",
    summary:
      "Plentiful and cheap during snowmelt, tighter in late summer and fall, and dry years cut supply.",
    monthlyAvailability: [
      0.8, 0.8, 0.85, 0.95, 1, 1, 0.9, 0.75, 0.6, 0.6, 0.7, 0.8,
    ],
    hourlyAvailability: hours(1, [17, 21, 0.95]),
    heatStressLoss: 0.15,
    coldStressLoss: 0.1,
    yearlyVariability: 0.12,
    lullChance: 0,
    lullAvailability: 1,
    hourlyPriceOffset: hours(0, [17, 21, 5]),
    monthlyPriceOffset: [2, 2, 0, -6, -12, -12, -4, 4, 10, 10, 6, 4],
    heatStressPremium: 12,
    coldStressPremium: 8,
    scarcityPremium: 60,
    priceNoise: 3,
  },
  RESERVOIR_HYDRO: {
    id: "RESERVOIR_HYDRO",
    label: "Stored hydro",
    summary:
      "Steady, low-emission supply most of the year; its own winter peak and deep cold leave less to spare.",
    monthlyAvailability: [
      0.75, 0.75, 0.85, 0.95, 1, 1, 1, 1, 1, 0.95, 0.9, 0.8,
    ],
    hourlyAvailability: hours(1, [7, 10, 0.95], [17, 21, 0.95]),
    heatStressLoss: 0.05,
    coldStressLoss: 0.3,
    yearlyVariability: 0.06,
    lullChance: 0,
    lullAvailability: 1,
    hourlyPriceOffset: hours(0, [7, 10, 3], [17, 21, 4]),
    monthlyPriceOffset: [8, 8, 3, 0, -3, -3, 0, 0, -2, 0, 3, 6],
    heatStressPremium: 8,
    coldStressPremium: 25,
    scarcityPremium: 40,
    priceNoise: 2,
  },
  SOLAR_HEAVY: {
    id: "SOLAR_HEAVY",
    label: "Solar surplus",
    summary:
      "Cheap and plentiful at midday; evenings are tight and expensive, especially after hot days.",
    monthlyAvailability: [
      0.85, 0.9, 0.95, 1, 1, 0.95, 0.9, 0.9, 0.95, 0.95, 0.9, 0.85,
    ],
    hourlyAvailability: hours(0.7, [9, 16, 1], [16, 17, 0.8], [17, 22, 0.5]),
    heatStressLoss: 0.25,
    coldStressLoss: 0.1,
    yearlyVariability: 0,
    lullChance: 0.1,
    lullAvailability: 0.8,
    hourlyPriceOffset: hours(4, [9, 16, -18], [16, 17, 6], [17, 22, 24]),
    monthlyPriceOffset: [2, 0, -2, -4, -4, 2, 6, 6, 2, 0, 0, 2],
    heatStressPremium: 30,
    coldStressPremium: 10,
    scarcityPremium: 20,
    priceNoise: 4,
  },
  WIND_HEAVY: {
    id: "WIND_HEAVY",
    label: "Wind surplus",
    summary:
      "Cheapest overnight and in windy seasons; calm spells and heat waves can leave little to import.",
    monthlyAvailability: [1, 1, 1, 1, 0.95, 0.85, 0.75, 0.75, 0.85, 0.95, 1, 1],
    hourlyAvailability: hours(1, [10, 17, 0.8], [17, 21, 0.85]),
    heatStressLoss: 0.3,
    coldStressLoss: 0.25,
    yearlyVariability: 0.04,
    lullChance: 0.2,
    lullAvailability: 0.45,
    hourlyPriceOffset: hours(
      0,
      [0, 6, -12],
      [22, 24, -8],
      [10, 17, 4],
      [17, 21, 10],
    ),
    monthlyPriceOffset: [-2, -4, -6, -6, -2, 4, 8, 8, 2, -2, -4, -2],
    heatStressPremium: 30,
    coldStressPremium: 25,
    scarcityPremium: 45,
    priceNoise: 6,
  },
  PEAK_SHARING: {
    id: "PEAK_SHARING",
    label: "Shares your peaks",
    summary:
      "Usually has power to spare, but its heat waves and cold snaps match yours, so it helps least when you need it most.",
    monthlyAvailability: [0.95, 0.95, 1, 1, 1, 0.95, 0.95, 0.95, 1, 1, 1, 0.95],
    hourlyAvailability: hours(1, [17, 21, 0.9]),
    heatStressLoss: null,
    coldStressLoss: null,
    yearlyVariability: 0,
    lullChance: 0,
    lullAvailability: 1,
    hourlyPriceOffset: hours(0, [0, 6, -6], [7, 10, 6], [17, 21, 16]),
    monthlyPriceOffset: [4, 4, 0, -4, -2, 4, 8, 8, 0, -4, 0, 4],
    heatStressPremium: 70,
    coldStressPremium: 60,
    scarcityPremium: 0,
    priceNoise: 5,
  },
  LARGE_POOL: {
    id: "LARGE_POOL",
    label: "Large pool",
    summary:
      "A big, diverse market that can almost always spare power at moderate prices.",
    monthlyAvailability: new Array(12).fill(1),
    hourlyAvailability: hours(1, [17, 21, 0.95]),
    heatStressLoss: 0.1,
    coldStressLoss: 0.1,
    yearlyVariability: 0,
    lullChance: 0,
    lullAvailability: 1,
    hourlyPriceOffset: hours(0, [0, 6, -5], [17, 21, 10]),
    monthlyPriceOffset: [2, 2, 0, -2, -2, 2, 4, 4, 0, -2, 0, 2],
    heatStressPremium: 20,
    coldStressPremium: 20,
    scarcityPremium: 0,
    priceNoise: 3,
  },
  FIRM_THERMAL: {
    id: "FIRM_THERMAL",
    label: "Fuel-fired",
    summary:
      "Steady but pricier supply from fuel-burning plants; prices follow fuel costs more than weather.",
    monthlyAvailability: new Array(12).fill(0.9),
    hourlyAvailability: hours(0.9, [17, 21, 0.85]),
    heatStressLoss: 0.15,
    coldStressLoss: 0.2,
    yearlyVariability: 0,
    lullChance: 0,
    lullAvailability: 1,
    hourlyPriceOffset: hours(0, [0, 6, -3], [17, 21, 6]),
    monthlyPriceOffset: FLAT_MONTHS,
    heatStressPremium: 25,
    coldStressPremium: 25,
    scarcityPremium: 0,
    priceNoise: 3,
  },
};

export const INTERTIE_ARCHETYPE_IDS = Object.keys(
  INTERTIE_ARCHETYPES,
) as IntertieArchetypeIdType[];
