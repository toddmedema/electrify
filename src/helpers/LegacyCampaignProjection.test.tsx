import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "./DateTime";
import { cashRunwayHorizon, ProjectionView } from "./Projection";
import { projectMission } from "./MissionProjection";
import type { MonthlyHistoryType } from "../Types";

function secondGeneration() {
  const game = cloneDeep(
    createGame({ scenarioId: 117, difficulty: "Manager", seed: 611 }),
  );
  game.scenarioId = 118;
  game.campaign = {
    ...game.campaign!,
    generationIndex: 1,
    termStartMonth: 240,
    referenceRate: 0.1,
  };
  game.date = getDateFromMinute(240 * MINUTES_PER_MONTH, 1882);
  game.timeline = [
    {
      ...game.timeline[0],
      minute: game.date.minute,
      cash: 1e9,
      customers: 100,
    },
  ];
  delete game.objectiveProgress;
  return game;
}

test("the second CEO retains a full remaining cash runway instead of inheriting an expired horizon", () => {
  const game = secondGeneration();
  expect(cashRunwayHorizon(game)).toBe(240);
  game.date = getDateFromMinute(246 * MINUTES_PER_MONTH, 1882);
  expect(cashRunwayHorizon(game)).toBe(234);
});

test("forecast goals use the current CEO's local evidence and actual calendar dates", () => {
  const game = secondGeneration();
  const row = (month: number): MonthlyHistoryType => ({
    ...EMPTY_HISTORY,
    year: 1882 + Math.floor(month / 12),
    month: (month % 12) + 1,
    customers: 100,
    cash: 1e9,
    supplyWh: 1e6,
    demandWh: 1e6,
    revenue: 100,
  });
  game.monthlyHistory = [row(239), row(238)];
  const projection: ProjectionView = {
    objectiveAssets: Array.from({ length: 240 }, (_, index) => ({
      month: 240 + index,
      debtPrincipal: 0,
      ownedFuels: { Coal: 1 },
      ownedAssetIds: ["legacy-first-steam"],
    })),
    forecast: [{ ...game.timeline[0], minute: 480 * MINUTES_PER_MONTH - 60 }],
    projectionStepMinutes: 60,
    financeProjected: Array.from({ length: 240 }, (_, index) =>
      row(240 + index),
    ),
    financePast: game.monthlyHistory,
    cashBaseline: game.timeline,
    startingCash: 1e9,
    startingCustomers: 100,
    timeline: [],
    sampled: [],
    supplyDemandTimeline: [],
    blackouts: [],
    domain: { x: [0, 1], y: [0, 1] },
    hasStorage: false,
    hasHydro: false,
    cashProjected: [],
  };
  const predicted = projectMission(game, projection);
  expect(predicted.status).toBe("win");
  expect(predicted.through).toContain("1921");
  expect(
    predicted.requirements.find(({ id }) => id === "retain-customers"),
  ).toMatchObject({
    status: "on-track",
    detail: expect.stringContaining("1921"),
  });
  expect(
    predicted.requirements.find(({ id }) => id === "funded-expansion"),
  ).toMatchObject({ status: "on-track" });
  expect(game.objectiveProgress).toBeUndefined();
});
