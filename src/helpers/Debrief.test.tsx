import { SCENARIOS } from "../data/Scenarios";
import { GameEventType, MonthlyHistoryType } from "../Types";
import { buildVictoryDebrief } from "./Debrief";
import { modScenario } from "../mods/ModScenario";
import { createGame } from "../testing/Simulator";
import { tickState } from "../reducers/Game";
import { summarizeHistory } from "./DateTime";

const summary = {
  cash: 500000000,
  customers: 1200000,
  supplyWh: 99,
  demandWh: 100,
  kgco2e: 2000000000,
} as MonthlyHistoryType;

it("interprets mod debriefs from completed facts and marks a missing-history neighbor unavailable", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "debrief-fixture",
    title: "Debrief",
    creator: "Creator",
    version: "1",
    description: "Recorded results.",
    baseScenarioId: 999,
    seed: 42,
    officialArcs: [],
    scenario: { startingCustomers: 10000, cash: 1e9, durationMonths: 6 },
    objectives: [],
    events: [
      {
        id: "outage",
        title: "Outage",
        message: "An original plant is offline.",
        preview: "An original plant will be offline.",
        startMonth: 1,
        durationMonths: 1,
        effects: {
          outputMultipliersBySelector: [
            { target: { selector: "largestOperating" }, outputMultiplier: 0 },
          ],
        },
      },
    ],
    debriefReports: [
      { id: "reliability", kind: "reliability", fromMonth: 1, throughMonth: 2 },
      { id: "affected", kind: "affectedFacilities", eventId: "outage" },
    ],
  });
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 42,
    weatherHazardsEnabled: false,
  });
  while (game.date.monthsElapsed < 2) tickState(game);
  const months = game.monthlyHistory;
  const debrief = buildVictoryDebrief(
    scenario,
    summarizeHistory(months),
    game.facilities,
    [],
    months,
    game.dollarsPerkWh,
    game.worldEvents.occurrences,
  );
  expect(debrief.scenarioMetrics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "Demand served",
        value: expect.stringMatching(/%$/),
      }),
      expect.objectContaining({
        label: "Affected facilities",
        value: "Natural Gas Peaker",
      }),
    ]),
  );
  const incomplete = buildVictoryDebrief(
    scenario,
    summarizeHistory(months),
    game.facilities,
    [],
    months.slice(0, 1),
    game.dollarsPerkWh,
    game.worldEvents.occurrences,
  );
  expect(incomplete.scenarioMetrics).toContainEqual(
    expect.objectContaining({
      label: "Grid reliability",
      value: expect.stringContaining("Report unavailable"),
    }),
  );
});

it("captures a plain then-versus-now story and the latest meaningful beats", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 100)!;
  const events = [
    {
      id: 2,
      kind: "CONSTRUCTION",
      label: "Jan 2028",
      message: "Construction complete: Solar",
    },
    {
      id: 1,
      kind: "BUILD",
      label: "Jan 2027",
      message: "Building Solar",
      importance: "NOTABLE",
    },
  ] as GameEventType[];
  const debrief = buildVictoryDebrief(
    scenario,
    summary,
    [
      { fuel: "Coal", peakW: 300000000, yearsToBuildLeft: 0 },
      { fuel: "Sun", peakW: 400000000, yearsToBuildLeft: 0 },
      { fuel: "Wind", peakW: 500000000, yearsToBuildLeft: 1 },
    ],
    events,
  );

  expect(debrief.startingFleet).toEqual([
    { fuel: "Coal", watts: 300000000 },
    { fuel: "Natural Gas", watts: 200000000 },
  ]);
  expect(debrief.finalFleet).toEqual([
    { fuel: "Sun", watts: 400000000 },
    { fuel: "Coal", watts: 300000000 },
  ]);
  expect(debrief.reliability).toBe(0.99);
  expect(debrief.highlights.map((event) => event.label)).toEqual([
    "Jan 2027",
    "Jan 2028",
  ]);
});

it("selects authored turning points intentionally before recent routine events", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 103)!;
  const events = [
    {
      id: 5,
      kind: "CONSTRUCTION",
      label: "Jan 2025",
      message: "A recent build",
    },
    {
      id: 4,
      kind: "WORLD_EVENT",
      label: "Mar 2016",
      message: "Normalization review",
      importance: "ROUTINE",
      turningPointPriority: 80,
    },
    {
      id: 3,
      kind: "WORLD_EVENT",
      label: "Jan 2014",
      message: "Winter gas squeeze",
      importance: "CRITICAL",
      turningPointPriority: 100,
    },
  ] as GameEventType[];
  const debrief = buildVictoryDebrief(scenario, summary, [], events);
  expect(debrief.highlights.map((event) => event.message)).toEqual([
    "Winter gas squeeze",
    "Normalization review",
    "A recent build",
  ]);
});

it("surfaces the researched Uri outcome metrics", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 107)!;
  const month = (
    monthNumber: number,
    overrides: Partial<MonthlyHistoryType> = {},
  ) =>
    ({
      ...summary,
      year: 2021,
      month: monthNumber,
      supplyWh: 1_000_000_000,
      demandWh: 1_000_000_000,
      revenue: 90_000,
      cash: 100_000_000,
      ...overrides,
    }) as MonthlyHistoryType;
  const debrief = buildVictoryDebrief(
    scenario,
    summary,
    [],
    [],
    [
      month(3, {
        revenue: 160_000,
        revenueExports: 10_000,
        revenueGrants: 50_000,
      }),
      month(2, {
        supplyWh: 900_000_000,
        demandWh: 1_000_000_000,
        minimumSupplyMarginW: -100_000_000,
      }),
      month(1),
    ],
  );

  expect(debrief.scenarioMetrics).toEqual([
    expect.objectContaining({
      label: "Demand not met during Winter Storm Uri · Feb 2021",
      value: "100MWh",
    }),
    expect.objectContaining({
      label: "Largest shortage during Winter Storm Uri",
      value: "100MW",
    }),
    expect.objectContaining({
      label: "Electricity rate · before → after",
      value: "$0.09/kWh → $0.1/kWh",
    }),
    expect.objectContaining({
      label: "Cash stayed above $0 through Mar 2021",
      value: "Yes",
    }),
  ]);
});

it("retains native connection metrics before and after arrival without waiting for the full term", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 106)!;
  const row = (
    year: number,
    month: number,
    patch: Partial<MonthlyHistoryType> = {},
  ) => ({ ...summary, year, month, demandWh: 100, supplyWh: 100, ...patch });
  const debrief = (months: MonthlyHistoryType[]) =>
    buildVictoryDebrief(scenario, summary, [], [], months, 0.12)
      .scenarioMetrics;
  expect(debrief([row(2025, 12)])).toEqual([
    {
      label: "Months with blackouts after Data Centers arrived",
      value: "Not reached",
      concept: "blackout",
    },
    {
      label: "Electricity rate",
      value: "$0.1/kWh → $0.12/kWh",
      concept: "rate",
    },
  ]);
  expect(
    debrief([
      row(2026, 2),
      row(2026, 1, { supplyWh: 90 }),
      row(2025, 12, { supplyWh: 0 }),
    ]),
  ).toEqual([
    {
      label: "Months with blackouts after Data Centers arrived",
      value: "1",
      concept: "blackout",
    },
    {
      label: "Electricity rate",
      value: "$0.1/kWh → $0.12/kWh",
      concept: "rate",
    },
  ]);
});

it("retains each native Uri observation when a run ends before recovery", () => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === 107)!;
  const row = (month: number, patch: Partial<MonthlyHistoryType> = {}) => ({
    ...summary,
    year: 2021,
    month,
    supplyWh: 1e9,
    demandWh: 1e9,
    revenue: 90000,
    cash: 1e8,
    minimumSupplyMarginW: 0,
    ...patch,
  });
  const before = row(1),
    impact = row(2, { supplyWh: 9e8, minimumSupplyMarginW: -1e8 });
  const result = buildVictoryDebrief(
    scenario,
    summary,
    [],
    [],
    [impact, before],
  ).scenarioMetrics;
  expect(result).toEqual([
    {
      label: "Demand not met during Winter Storm Uri · Feb 2021",
      value: "100MWh",
      concept: "blackout",
    },
    {
      label: "Largest shortage during Winter Storm Uri",
      value: "100MW",
      concept: "supply",
    },
    {
      label: "Electricity rate · before → after",
      value: "Not reached",
      concept: "rate",
    },
    {
      label: "Cash stayed above $0 through Mar 2021",
      value: "Not reached",
      concept: "money",
    },
  ]);
  const unreached = buildVictoryDebrief(
    scenario,
    summary,
    [],
    [],
    [before],
  ).scenarioMetrics;
  expect(unreached).toHaveLength(4);
  expect(unreached!.every((metric) => metric.value === "Not reached")).toBe(
    true,
  );
});

it("derives native review dates from the resolved starting year", () => {
  const scenario = {
    ...SCENARIOS.find((candidate) => candidate.id === 107)!,
    startingYear: 2037,
  };
  const months = [1, 2, 3].map((month) => ({
    ...summary,
    year: 2041,
    month,
    supplyWh: 1e9,
    demandWh: 1e9,
    revenue: 90000,
    cash: 1e8,
    minimumSupplyMarginW: 0,
  }));
  const metrics = buildVictoryDebrief(
    scenario,
    summary,
    [],
    [],
    months,
  ).scenarioMetrics;
  expect(metrics).toContainEqual({
    label: "Demand not met during Winter Storm Uri · Feb 2041",
    value: "0Wh",
    concept: "blackout",
  });
  expect(metrics).toContainEqual({
    label: "Cash stayed above $0 through Mar 2041",
    value: "Yes",
    concept: "money",
  });
});
