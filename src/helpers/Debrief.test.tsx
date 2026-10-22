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
    objectives: { mode: "none" },
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
    wildfireHazardEnabled: false,
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
