import {
  DateType,
  DemandByTypeType,
  DemandTypeNameType,
  LocationType,
} from "../Types";
import { DAYS_PER_YEAR } from "../Constants";

export const DEMAND_TYPES: readonly DemandTypeNameType[] = [
  "Residential",
  "Commercial",
  "Industrial",
  "Transportation",
  "Data centers",
] as const;

type NonDataCenterType = Exclude<DemandTypeNameType, "Data centers">;
type SectorMix = Record<NonDataCenterType, number>;
type GrowthProfile = Record<NonDataCenterType, number>;

// EIA divides end-use demand into residential, commercial, industrial, and transportation.
// These broad regional mixes preserve that standard while data centers are pulled out of the
// commercial sector below. They are intentionally scenario-scale profiles rather than a claim
// that every city in a region has an identical measured mix.
// https://www.eia.gov/tools/faqs/faq.php?id=447&t=1
const REGION_MIX: Record<string, SectorMix> = {
  "North America": {
    Residential: 0.39,
    Commercial: 0.34,
    Industrial: 0.265,
    Transportation: 0.005,
  },
  "South America": {
    Residential: 0.35,
    Commercial: 0.24,
    Industrial: 0.4,
    Transportation: 0.01,
  },
  Europe: {
    Residential: 0.33,
    Commercial: 0.31,
    Industrial: 0.34,
    Transportation: 0.02,
  },
  Africa: {
    Residential: 0.5,
    Commercial: 0.2,
    Industrial: 0.29,
    Transportation: 0.01,
  },
  "Middle East": {
    Residential: 0.38,
    Commercial: 0.3,
    Industrial: 0.31,
    Transportation: 0.01,
  },
  "South Asia": {
    Residential: 0.38,
    Commercial: 0.21,
    Industrial: 0.4,
    Transportation: 0.01,
  },
  "East Asia": {
    Residential: 0.22,
    Commercial: 0.25,
    Industrial: 0.52,
    Transportation: 0.01,
  },
  "Southeast Asia": {
    Residential: 0.32,
    Commercial: 0.24,
    Industrial: 0.43,
    Transportation: 0.01,
  },
  Oceania: {
    Residential: 0.37,
    Commercial: 0.32,
    Industrial: 0.29,
    Transportation: 0.02,
  },
};

// Annual change in load per customer. Customer growth remains the common demographic baseline;
// these rates create the issue's location-sensitive structural change on top of it: mature
// regions can flatten, industrial load can retreat, and electrified transport can grow.
const REGION_GROWTH: Record<string, GrowthProfile> = {
  "North America": {
    Residential: 0,
    Commercial: 0.002,
    Industrial: -0.002,
    Transportation: 0.025,
  },
  "South America": {
    Residential: 0.004,
    Commercial: 0.006,
    Industrial: 0.005,
    Transportation: 0.02,
  },
  Europe: {
    Residential: -0.003,
    Commercial: 0,
    Industrial: -0.005,
    Transportation: 0.025,
  },
  Africa: {
    Residential: 0.012,
    Commercial: 0.015,
    Industrial: 0.014,
    Transportation: 0.025,
  },
  "Middle East": {
    Residential: 0.008,
    Commercial: 0.01,
    Industrial: 0.009,
    Transportation: 0.025,
  },
  "South Asia": {
    Residential: 0.012,
    Commercial: 0.014,
    Industrial: 0.015,
    Transportation: 0.025,
  },
  "East Asia": {
    Residential: -0.003,
    Commercial: 0.004,
    Industrial: 0.006,
    Transportation: 0.025,
  },
  "Southeast Asia": {
    Residential: 0.01,
    Commercial: 0.013,
    Industrial: 0.015,
    Transportation: 0.025,
  },
  Oceania: {
    Residential: 0.005,
    Commercial: 0.006,
    Industrial: 0.002,
    Transportation: 0.03,
  },
};

const DEFAULT_MIX = REGION_MIX["North America"];
const DEFAULT_GROWTH = REGION_GROWTH["North America"];

// These are historical/projected shares of total U.S. electricity, linearly interpolated between
// published observations. 2000 (28.2 TWh) and 2006 (61.4 TWh) are from DOE's data-center energy
// profile; 2014, 2018, 2023 and the 2028 midpoint are from Berkeley Lab's 2024 report. The 2028
// midpoint represents its 6.7%-12.0% scenario range, not a false point forecast.
// https://www1.eere.energy.gov/manufacturing/datacenters/pdfs/chp_data_centers.pdf
// https://eta-publications.lbl.gov/sites/default/files/2024-12/lbnl-2024-united-states-data-center-energy-usage-report_1.pdf
const US_DATA_CENTER_SHARES: readonly [number, number][] = [
  [1999, 0],
  [2000, 0.008],
  [2006, 0.015],
  [2014, 0.015],
  [2018, 0.019],
  [2023, 0.044],
  [2028, 0.0935],
  [2035, 0.14],
];

const REGION_DATA_CENTER_FACTOR: Record<string, number> = {
  "North America": 0.9,
  "South America": 0.35,
  Europe: 0.75,
  Africa: 0.2,
  "Middle East": 0.45,
  "South Asia": 0.45,
  "East Asia": 0.9,
  "Southeast Asia": 0.65,
  Oceania: 0.7,
};

// Berkeley Lab identifies Virginia as the largest U.S. data-center load, followed by California
// and Texas. Multipliers turn that ordinal real-world finding into game-scale local exposure;
// they are deliberately capped below rather than presented as measured state shares.
const US_DATA_CENTER_FACTOR: Record<string, number> = {
  VA: 2.8,
  CA: 1.35,
  TX: 1.35,
};

const RUST_BELT = new Set(["MI", "OH", "PA", "WV"]);
const HIGH_GROWTH_US = new Set(["AZ", "FL", "GA", "NC", "TX"]);

function adminFor(location?: LocationType): string | undefined {
  return (location as (LocationType & { admin?: string }) | undefined)?.admin;
}

function interpolate(
  points: readonly [number, number][],
  year: number,
): number {
  if (year < points[0][0]) {
    return points[0][1];
  }
  for (let i = 1; i < points.length; i++) {
    const [nextYear, nextValue] = points[i];
    const [previousYear, previousValue] = points[i - 1];
    if (year <= nextYear) {
      const progress = (year - previousYear) / (nextYear - previousYear);
      return previousValue + (nextValue - previousValue) * progress;
    }
  }
  const [lastYear, lastValue] = points[points.length - 1];
  // Long-range uncertainty is high. Taper the post-2035 curve and keep one category from taking
  // over the whole grid even in century-long sandbox games.
  return Math.min(0.2, lastValue * Math.pow(1.02, year - lastYear));
}

/** Fraction of local demand represented by data centers before the other sector trends apply. */
export function dataCenterLoadShare(
  year: number,
  location?: LocationType,
): number {
  const national = interpolate(US_DATA_CENTER_SHARES, year);
  if (location?.country === "United States") {
    return Math.min(
      0.25,
      national * (US_DATA_CENTER_FACTOR[adminFor(location) || ""] || 1),
    );
  }
  const regional = REGION_DATA_CENTER_FACTOR[location?.region || ""] || 0.5;
  return Math.min(0.2, national * regional);
}

function growthFor(location?: LocationType): GrowthProfile {
  const profile = {
    ...(REGION_GROWTH[location?.region || ""] || DEFAULT_GROWTH),
  };
  if (location?.country !== "United States") {
    return profile;
  }
  const admin = adminFor(location) || "";
  if (RUST_BELT.has(admin)) {
    return {
      Residential: -0.005,
      Commercial: -0.003,
      Industrial: -0.015,
      Transportation: profile.Transportation,
    };
  }
  if (HIGH_GROWTH_US.has(admin)) {
    return {
      Residential: 0.01,
      Commercial: 0.015,
      Industrial: 0.01,
      Transportation: profile.Transportation,
    };
  }
  if (admin === "CA") {
    return {
      Residential: -0.002,
      Commercial: 0.005,
      Industrial: -0.006,
      Transportation: 0.04,
    };
  }
  return profile;
}

function hourShape(type: DemandTypeNameType, minuteOfDay: number): number {
  const hour = minuteOfDay / 60;
  const peak = (at: number, width: number) =>
    Math.exp(-Math.pow(hour - at, 2) / (2 * width * width));
  switch (type) {
    case "Residential":
      return 0.65 + 0.45 * peak(7, 1.8) + 0.75 * peak(19, 2.5);
    case "Commercial":
      return 0.35 + 0.9 * peak(13, 4.5);
    case "Industrial":
      return 1;
    case "Transportation":
      return 0.55 + 0.8 * peak(1, 3) + 0.55 * peak(21, 2.5);
    case "Data centers":
      return 1;
  }
}

/**
 * Splits baseline demand into five end uses and applies their local trajectories.
 *
 * The starting instant is normalised back to baselineDemandW, so authored scenarios retain their
 * tuned opening balance. After that, the components can diverge and their sum becomes the actual
 * demand used by dispatch, finance, blackout logic, and the Insights forecast.
 */
export function demandByTypeAt(
  baselineDemandW: number,
  date: DateType,
  startingYear: number,
  location?: LocationType,
): DemandByTypeType {
  const mix = REGION_MIX[location?.region || ""] || DEFAULT_MIX;
  const growth = growthFor(location);
  const startDataCenters = dataCenterLoadShare(startingYear, location);
  // date.percentOfYear deliberately substitutes 0.00001 at midnight on New Year's Day for
  // legacy chart math. Elapsed game minutes give this model a true zero at scenario start.
  const currentYear = startingYear + date.minute / (DAYS_PER_YEAR * 24 * 60);
  const years = Math.max(0, currentYear - startingYear);
  const currentDataCenters = dataCenterLoadShare(currentYear, location);
  const nonDataCenterScale = 1 - startDataCenters;

  const startingWeights = {
    Residential: nonDataCenterScale * mix.Residential,
    Commercial: nonDataCenterScale * mix.Commercial,
    Industrial: nonDataCenterScale * mix.Industrial,
    Transportation: nonDataCenterScale * mix.Transportation,
    "Data centers": startDataCenters,
  } satisfies Record<DemandTypeNameType, number>;
  const shapedStartingTotal = DEMAND_TYPES.reduce(
    (sum, type) =>
      sum + startingWeights[type] * hourShape(type, date.minuteOfDay),
    0,
  );

  const result = {} as DemandByTypeType;
  DEMAND_TYPES.forEach((type) => {
    const shape = hourShape(type, date.minuteOfDay);
    if (type === "Data centers") {
      // When a game begins before 2000 there is no starting component to grow, so introduce the
      // later load directly. Otherwise scale the opening component along the measured curve.
      const weight =
        startDataCenters > 0
          ? startingWeights[type] * (currentDataCenters / startDataCenters)
          : currentDataCenters;
      result[type] = (baselineDemandW * weight * shape) / shapedStartingTotal;
      return;
    }
    result[type] =
      (baselineDemandW *
        startingWeights[type] *
        shape *
        Math.pow(1 + growth[type], years)) /
      shapedStartingTotal;
  });
  if (years === 0) {
    const openingTotal = DEMAND_TYPES.reduce(
      (sum, type) => sum + result[type],
      0,
    );
    // Besides preserving authored balance conceptually, keep it bit-for-bit stable. A few UI
    // calculations compare the change in reserve capacity after adding a plant, and a residual
    // fraction of a watt from summing five floating-point components should not leak into that.
    result["Data centers"] += baselineDemandW - openingTotal;
  }
  return result;
}
