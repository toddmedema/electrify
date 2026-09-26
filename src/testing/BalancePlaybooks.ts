import { ScheduledSimActionType, SimOptionsType } from "./Simulator";

const rate = (dollarsPerkWh: number): ScheduledSimActionType => ({
  month: 0,
  type: "rate",
  dollarsPerkWh,
});

const programs = (month: number): ScheduledSimActionType[] => [
  { month, type: "policy", id: "efficiency", tier: "On" },
  { month, type: "policy", id: "solar", tier: "On" },
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
 * ten material choices (including mandatory scenario responses) across at least four categories,
 * no more than one rate setting, and no
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
      // The binding data-center connection is the tenth material choice.
      ...dispatch([1, 2]),
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
    // Fast construction covers the nuclear trip before a new gas plant could arrive.
    initialBuild: { name: "Oil", peakW: 300000000, financed: true },
    scheduledActions: [
      rate(0.141),
      ...line("france-core-upgrade"),
      ...dispatch([2, 3, 6]),
      { month: 47, type: "toggle", facilityId: 2 },
      ...programs(46),
    ],
  },
  111: {
    // Limited import access makes preparing the local grid a real reliability decision.
    scenarioResponses: {
      "story:111:california-wildfire-2025:preparedness": "prepare",
    },
    scheduledActions: [
      rate(0.171),
      ...line("california-north"),
      ...dispatch([1, 2, 3, 4]),
      ...programs(34),
    ],
  },
  113: {
    initialBuild: { name: "Natural Gas", peakW: 300000000, financed: true },
    scheduledActions: [
      rate(0.115),
      ...line("south-africa-mozambique-upgrade", 8, 7),
      ...dispatch([1, 2, 3]),
      { month: 59, type: "toggle", facilityId: 1 },
      ...programs(58),
    ],
  },
  114: {
    // Diesel, not gas. Gas takes over three years to build at CEO's full build time and the
    // drought bottoms out at month 32, so a gas plant ordered on the opening tick arrives after
    // the lake has already emptied. Diesel is a year and a half, which is in time, and it is
    // what the utility being modelled actually ran - at a fuel cost the tariff rise has to cover.
    initialBuild: { name: "Oil", peakW: 150000000, financed: true },
    scheduledActions: [
      rate(0.095),
      ...line("zambia-zimbabwe-upgrade", 8, 7),
      ...dispatch([1, 2, 3]),
      { month: 47, type: "toggle", facilityId: 2 },
      ...programs(46),
    ],
  },
  115: {
    initialBuild: { name: "Natural Gas", peakW: 700000000, financed: true },
    scheduledActions: [
      rate(0.095),
      ...line("india-himalaya-upgrade", 8, 7),
      ...dispatch([1, 2, 3]),
      { month: 35, type: "toggle", facilityId: 1 },
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
  113: {
    initialBuild: { name: "Natural Gas", peakW: 200000000, financed: true },
  },
  114: {
    initialBuild: { name: "Natural Gas", peakW: 150000000, financed: true },
  },
  115: {
    initialBuild: { name: "Natural Gas", peakW: 400000000, financed: true },
  },
};
