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
