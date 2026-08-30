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
  104: { dollarsPerkWh: 0.08 },
  105: {
    // Oil's output-dependent O&M makes the old $0.08/kWh play run out of cash in 2007.
    dollarsPerkWh: 0.085,
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
  },
};
