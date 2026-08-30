import { SCENARIOS } from "../data/Scenarios";
import { GameEventType, MonthlyHistoryType } from "../Types";
import { buildVictoryDebrief } from "./Debrief";

const summary = {
  cash: 500000000,
  customers: 1200000,
  supplyWh: 99,
  demandWh: 100,
  kgco2e: 2000000000,
} as MonthlyHistoryType;

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
