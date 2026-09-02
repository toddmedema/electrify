import { SimOptionsType } from "./Simulator";

/**
 * Reproducible, UI-legal playthroughs used by both the CEO economics gates and the seeded story
 * matrix. They deliberately contain only actions the headless simulator records as player input.
 */
export const STANDARD_BALANCE_PLAYS: Record<number, Partial<SimOptionsType>> = {
  100: {
    // The announced carbon-fee step makes the old $0.055/kWh gas-heavy play insolvent.
    dollarsPerkWh: 0.08,
    initialBuild: {
      name: "Natural Gas",
      peakW: 150000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 37,
  },
  101: {
    dollarsPerkWh: 0.1,
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 39,
  },
  102: {
    dollarsPerkWh: 0.15,
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 39,
  },
  103: {
    // This control must remain viable without the shale discount as well as with it.
    dollarsPerkWh: 0.08,
    initialBuild: {
      name: "Natural Gas",
      peakW: 600000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 39,
  },
  104: {
    dollarsPerkWh: 0.08,
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 110,
  },
  105: {
    // Oil's output-dependent O&M makes the old $0.08/kWh play run out of cash in 2007.
    dollarsPerkWh: 0.085,
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 39,
  },
};

/**
 * The single commitment that teaches each Intern scenario's intended first lesson. These use no
 * tariff change, sale, or reactive strategy: passive play must fail, while this one build wins.
 */
export const INTERN_ONE_BUILD_PLAYS: Record<
  number,
  Pick<SimOptionsType, "initialBuild">
> = {
  100: {
    initialBuild: { name: "Geothermal", peakW: 500000000, financed: true },
  },
  101: {
    initialBuild: { name: "Natural Gas", peakW: 390000000, financed: true },
  },
  102: {
    initialBuild: { name: "Natural Gas", peakW: 350000000, financed: true },
  },
  103: {
    initialBuild: { name: "Natural Gas", peakW: 600000000, financed: true },
  },
  104: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
  },
  105: {
    initialBuild: { name: "Natural Gas", peakW: 525000000, financed: true },
  },
  108: {
    initialBuild: { name: "Natural Gas", peakW: 250000000, financed: true },
  },
  109: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
  },
  110: {
    initialBuild: { name: "Natural Gas", peakW: 400000000, financed: true },
  },
};
