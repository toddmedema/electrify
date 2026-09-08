import { ScheduledSimActionType, SimOptionsType } from "./Simulator";

function rateSteps(
  startingRate: number,
  count: number,
): ScheduledSimActionType[] {
  return Array.from({ length: count }, (_, index) => ({
    month: index * 2,
    type: "rate" as const,
    // A small, staged tariff plan: each setting remains in force for two settlements.
    dollarsPerkWh: startingRate + index * 0.00025,
  }));
}

function modernDecisionPlan(
  startingRate: number,
  count: 8 | 9,
): ScheduledSimActionType[] {
  return rateSteps(startingRate, count);
}

/**
 * Reproducible, UI-legal playthroughs used by both the CEO economics gates and the seeded story
 * matrix. They deliberately contain only actions the headless simulator records as player input.
 */
export const STANDARD_BALANCE_PLAYS: Record<number, Partial<SimOptionsType>> = {
  100: {
    // The announced carbon-fee step makes the old $0.055/kWh gas-heavy play insolvent.
    initialBuild: {
      name: "Natural Gas",
      peakW: 150000000,
      financed: true,
    },
    sellFacilityId: 2,
    sellAtMonth: 37,
    scheduledActions: modernDecisionPlan(0.08, 8),
  },
  101: {
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 2,
    sellAtMonth: 39,
    scheduledActions: modernDecisionPlan(0.1, 8),
  },
  102: {
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 39,
    scheduledActions: rateSteps(0.15, 8),
  },
  103: {
    // This control must remain viable without the shale discount as well as with it.
    initialBuild: {
      name: "Natural Gas",
      peakW: 600000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 39,
    scheduledActions: rateSteps(0.08, 8),
  },
  104: {
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 1,
    sellAtMonth: 110,
    scheduledActions: modernDecisionPlan(0.08, 8),
  },
  105: {
    // Oil's output-dependent O&M makes the old $0.08/kWh play run out of cash in 2007.
    initialBuild: {
      name: "Natural Gas",
      peakW: 300000000,
      financed: true,
    },
    sellFacilityId: 3,
    sellAtMonth: 39,
    scheduledActions: modernDecisionPlan(0.085, 8),
  },
  106: {
    initialBuild: { name: "Natural Gas", peakW: 50000000, financed: true },
    scheduledActions: modernDecisionPlan(0.101, 9),
  },
  107: {
    initialBuild: { name: "Natural Gas", peakW: 1800000000, financed: true },
    scheduledActions: modernDecisionPlan(0.091, 9),
  },
  108: {
    initialBuild: { name: "Oil", peakW: 250000000, financed: true },
    scheduledActions: modernDecisionPlan(0.241, 9),
  },
  110: {
    initialBuild: { name: "Oil", peakW: 400000000, financed: true },
    scheduledActions: modernDecisionPlan(0.141, 9),
  },
  111: {
    // The one-year northern intertie is the only new firm resource that can be commissioned
    // between the warning and the firestorm on full CEO construction times.
    scheduledActions: [
      {
        month: 0,
        type: "intertie",
        corridorId: "california-north",
        financed: true,
      },
      ...modernDecisionPlan(0.171, 9),
    ],
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
    initialBuild: { name: "Natural Gas", peakW: 500000000, financed: true },
  },
  105: {
    initialBuild: { name: "Natural Gas", peakW: 525000000, financed: true },
  },
  106: {
    initialBuild: { name: "Natural Gas", peakW: 50000000, financed: true },
  },
  107: {
    initialBuild: { name: "Natural Gas", peakW: 1800000000, financed: true },
  },
  108: {
    initialBuild: { name: "Natural Gas", peakW: 250000000, financed: true },
  },
  110: {
    initialBuild: { name: "Natural Gas", peakW: 400000000, financed: true },
  },
  111: {
    initialBuild: { name: "Natural Gas", peakW: 20000000, financed: true },
  },
};
