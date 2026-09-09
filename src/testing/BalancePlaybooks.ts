import { ScheduledSimActionType, SimOptionsType } from "./Simulator";

const rate = (dollarsPerkWh: number): ScheduledSimActionType => ({
  month: 0,
  type: "rate",
  dollarsPerkWh,
});

const programs = (month: number): ScheduledSimActionType[] => [
  { month, type: "policy", id: "efficiency", tier: "Small" },
  { month, type: "policy", id: "solar", tier: "Small" },
];

const dispatch = (
  facilityIds: number[],
  startingMonth = 2,
): ScheduledSimActionType[] =>
  facilityIds.map((facilityId, index) => ({
    month: startingMonth + index,
    type: "reprioritize",
    facilityId,
  }));

const line = (
  corridorId: string,
  tradingMonth = 1,
  buildMonth = 0,
): ScheduledSimActionType[] => [
  { month: buildMonth, type: "intertie", corridorId, financed: true },
  {
    month: tradingMonth,
    type: "trading",
    policy: "RELIABILITY_FIRST",
  },
];

/**
 * Reproducible CEO plans made from persistent, UI-legal commitments. Every plan contains exactly
 * ten material choices across at least four categories, no more than one rate setting, and no
 * inverse action. Late operating/program changes still remain in force through a settlement.
 */
export const STANDARD_BALANCE_PLAYS: Record<number, Partial<SimOptionsType>> = {
  100: {
    initialBuild: { name: "Natural Gas", peakW: 150000000, financed: true },
    sellFacilityId: 2,
    sellAtMonth: 37,
    scheduledActions: [
      rate(0.08),
      ...line("california-north"),
      ...dispatch([1, 3]),
      { month: 36, type: "toggle", facilityId: 2 },
      ...programs(142),
    ],
  },
  101: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
    sellFacilityId: 2,
    sellAtMonth: 143,
    scheduledActions: [
      rate(0.1),
      {
        month: 1,
        type: "build",
        build: { name: "Natural Gas", peakW: 20000000, financed: true },
      },
      ...dispatch([1, 2, 3, 4]),
      { month: 141, type: "toggle", facilityId: 1 },
      { month: 142, type: "toggle", facilityId: 2 },
    ],
  },
  102: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
    sellFacilityId: 1,
    sellAtMonth: 39,
    scheduledActions: [
      rate(0.15),
      {
        month: 1,
        type: "build",
        build: { name: "Natural Gas", peakW: 20000000, financed: true },
      },
      ...dispatch([1, 2, 3, 4], 3),
      { month: 38, type: "toggle", facilityId: 1 },
      { month: 38, type: "toggle", facilityId: 2 },
    ],
  },
  103: {
    initialBuild: { name: "Natural Gas", peakW: 600000000, financed: true },
    sellFacilityId: 1,
    sellAtMonth: 39,
    scheduledActions: [
      rate(0.08),
      {
        month: 1,
        type: "build",
        build: { name: "Natural Gas", peakW: 10000000, financed: true },
      },
      {
        month: 2,
        type: "build",
        build: { name: "Natural Gas", peakW: 10000000, financed: true },
      },
      ...dispatch([1, 2, 3, 4], 3),
      { month: 38, type: "toggle", facilityId: 1 },
    ],
  },
  104: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
    sellFacilityId: 1,
    sellAtMonth: 110,
    scheduledActions: [
      rate(0.08),
      ...dispatch([1, 2, 3, 4]),
      { month: 109, type: "toggle", facilityId: 1 },
      ...programs(238),
    ],
  },
  105: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
    sellFacilityId: 3,
    sellAtMonth: 39,
    scheduledActions: [
      rate(0.085),
      ...dispatch([1, 2, 3, 4]),
      { month: 38, type: "toggle", facilityId: 3 },
      ...programs(142),
    ],
  },
  106: {
    initialBuild: { name: "Natural Gas", peakW: 50000000, financed: true },
    sellFacilityId: 2,
    sellAtMonth: 191,
    scheduledActions: [
      rate(0.101),
      ...dispatch([1, 2, 3]),
      ...line("pjm-miso-upgrade", 189, 188),
      ...programs(190),
    ],
  },
  107: {
    initialBuild: { name: "Natural Gas", peakW: 1800000000, financed: true },
    scheduledActions: [
      rate(0.091),
      ...dispatch([1, 2, 3, 4, 5]),
      { month: 82, type: "toggle", facilityId: 4 },
      ...programs(82),
    ],
  },
  108: {
    initialBuild: { name: "Oil", peakW: 250000000, financed: true },
    scheduledActions: [
      rate(0.241),
      ...line("spain-portugal-upgrade"),
      ...dispatch([1, 2, 7]),
      { month: 35, type: "toggle", facilityId: 1 },
      ...programs(34),
    ],
  },
  110: {
    // Oil cannot economically serve this long replacement duty at its corrected carbon cost.
    initialBuild: { name: "Natural Gas", peakW: 400000000, financed: true },
    scheduledActions: [
      rate(0.141),
      ...line("france-core-upgrade"),
      ...dispatch([2, 3, 6]),
      { month: 47, type: "toggle", facilityId: 2 },
      ...programs(46),
    ],
  },
  111: {
    scheduledActions: [
      rate(0.171),
      ...line("california-north"),
      ...dispatch([1, 2, 3, 4]),
      { month: 35, type: "toggle", facilityId: 5 },
      ...programs(34),
    ],
  },
};

/** The single material commitment that teaches each Intern scenario's intended first lesson. */
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
