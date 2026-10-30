import cloneDeep from "lodash.clonedeep";
import type { RuleObjective } from "../data/ScenarioRules";
import { modScenario } from "../mods/ModScenario";
import { modPackage } from "../testing/ModFixtures";
import { createGame } from "../testing/Simulator";
import type { GameType, MonthlyHistoryType } from "../Types";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "./DateTime";
import { projectMission } from "./MissionProjection";
import { recordGameObjectiveMonth } from "./ObjectiveRules";
import { selectProjection, ProjectionView } from "./Projection";
import { getTotalDebt } from "./Financials";
import {
  generateForecastTimeline,
  generateNewTimeline,
} from "../reducers/Game";

const reliability: RuleObjective = {
  id: "reliable",
  label: "Serve demand",
  metric: "monthlyReliability",
  fromMonth: 1,
  throughMonth: 3,
  minDemandServedShare: 0.995,
};
function fixture(objectives: RuleObjective[] = [reliability]) {
  const game = cloneDeep(
    createGame({
      scenarioId: 999,
      scenario: modScenario(
        modPackage({
          officialArcs: [],
          objectives,
          scenario: {
            durationMonths: 6,
            startingYear: 2020,
            startingCustomers: 1000,
            cash: 1e9,
          },
        }),
        undefined,
        "Employee",
      ),
    }),
  );
  const row = (month: number): MonthlyHistoryType => ({
    ...EMPTY_HISTORY,
    year: 2020,
    month,
    supplyWh: 1e6,
    demandWh: 1e6,
    customers: 1000,
    cash: 100,
    revenue: 100,
    deliveredWhByFuel: { Wind: 1e6 },
  });
  const projection: ProjectionView = {
    forecast: [{ ...game.timeline[0], minute: 6 * MINUTES_PER_MONTH - 60 }],
    projectionStepMinutes: 60,
    financeProjected: [1, 2, 3, 4, 5, 6].map(row),
    cashBaseline: game.timeline,
    startingCash: game.timeline[0].cash,
    startingCustomers: 1000,
    timeline: [],
    sampled: [],
    supplyDemandTimeline: [],
    blackouts: [],
    domain: { x: [0, 1], y: [0, 1] },
    hasStorage: false,
    hasHydro: false,
    financePast: [],
    cashProjected: [],
  };
  return { game, projection };
}
const goal = (game: GameType, projection: ProjectionView, id: string) =>
  projectMission(game, projection).requirements.find((row) => row.id === id)!;

it("flags a future reliability miss without changing recorded progress, then clears it after a new plan", () => {
  const { game, projection } = fixture();
  const recorded = cloneDeep(game.objectiveProgress);
  expect(projectMission(game, projection).status).toBe("win");
  const risky = cloneDeep(projection);
  risky.financeProjected[1].supplyWh *= 0.994999;
  expect(goal(game, risky, "reliable")).toMatchObject({ status: "at-risk" });
  expect(goal(game, risky, "reliable").detail).toContain("99.4999%");
  expect(projectMission(game, risky).status).toBe("loss");
  const approximate = cloneDeep(projection);
  approximate.financeProjected[1].supplyWh *= 0.765824;
  expect(goal(game, approximate, "reliable").detail).toContain("76.6%");
  expect(game.objectiveProgress).toEqual(recorded);
  expect(projectMission(game, projection).status).toBe("win");
});

it("checks month-end cash, anchors purchases once, and ignores negative intramonth balances", () => {
  const { game, projection } = fixture();
  projection.cashBaseline = [
    { ...game.timeline[0], cash: game.timeline[0].cash + 200 },
  ];
  expect(goal(game, projection, "cash")).toMatchObject({ status: "at-risk" });
  expect(goal(game, projection, "cash").detail).toContain("Jan 2020 month-end");
  expect(goal(game, projection, "cash").detail).toContain("−$100");
  game.timeline[0].cash -= 500;
  projection.cashBaseline = [{ ...game.timeline[0] }];
  projection.forecast[0].cash = -1000;
  projection.financeProjected[0].cash = 0;
  expect(goal(game, projection, "cash").status).toBe("on-track");
});

it.each(["Employee", "CEO"] as const)(
  "includes two recorded months in the %s blackout threshold",
  (difficulty) => {
    const { game, projection } = fixture([]);
    game.difficulty = difficulty;
    game.date = getDateFromMinute(2 * MINUTES_PER_MONTH, game.startingYear);
    const served = difficulty === "CEO" ? 0.94 : 0.89;
    const rows = projection.financeProjected.map((row) => ({
      ...row,
      supplyWh: row.demandWh * served,
    }));
    game.monthlyHistory = rows.slice(0, 2).reverse();
    projection.financeProjected = rows.slice(2);
    expect(goal(game, projection, "survival")).toMatchObject({
      status: "at-risk",
      detail: expect.stringContaining("Mar 2020"),
    });
    projection.financeProjected.forEach((row) => {
      row.supplyWh = row.demandWh;
    });
    expect(goal(game, projection, "survival").status).toBe("on-track");
  },
);

it("does not replace a recorded blackout failure with a healthy forecast", () => {
  const { game, projection } = fixture([]);
  game.date = getDateFromMinute(3 * MINUTES_PER_MONTH, game.startingYear);
  game.monthlyHistory = projection.financeProjected
    .map((row) => ({ ...row, supplyWh: 0 }))
    .reverse();
  projection.financeProjected = [];
  expect(goal(game, projection, "survival").status).toBe("failed");
  expect(projectMission(game, projection).status).toBe("loss");
});

it("keeps optional misses out of the win verdict and preserves an irreversible recorded miss", () => {
  const { game, projection } = fixture([{ ...reliability, required: false }]);
  projection.financeProjected[0].supplyWh *= 0.99;
  expect(goal(game, projection, "reliable").status).toBe("at-risk");
  expect(projectMission(game, projection).status).toBe("win");
  const required = fixture();
  const missed = { ...required.projection.financeProjected[0], supplyWh: 0 };
  recordGameObjectiveMonth(required.game, missed);
  required.game.date = getDateFromMinute(MINUTES_PER_MONTH, 2020);
  required.game.monthlyHistory = [missed];
  required.projection.financeProjected.shift();
  expect(goal(required.game, required.projection, "reliable").status).toBe(
    "failed",
  );
  expect(projectMission(required.game, required.projection).status).toBe(
    "loss",
  );
});

it("never claims a win with a truncated horizon, missing months, invalid data, or a partial final month", () => {
  for (const change of [
    (p: ProjectionView) => {
      p.financeProjected.pop();
    },
    (p: ProjectionView) => {
      p.financeProjected.splice(1, 1);
    },
    (p: ProjectionView) => {
      p.financeProjected[1].cash = NaN;
    },
    (p: ProjectionView) => {
      p.forecast[0].minute -= 60;
    },
  ]) {
    const { game, projection } = fixture();
    change(projection);
    expect(projectMission(game, projection).status).toBe("unknown");
  }
  const { game, projection } = fixture();
  projection.financeProjected[0].cash = -1;
  projection.financeProjected.pop();
  expect(projectMission(game, projection).status).toBe("loss");
});

it("still flags a known future miss when recorded history is incomplete", () => {
  const { game, projection } = fixture();
  game.date = getDateFromMinute(MINUTES_PER_MONTH, 2020);
  delete game.objectiveProgress;
  projection.financeProjected.shift();
  projection.financeProjected[0].supplyWh *= 0.99;
  expect(goal(game, projection, "reliable").status).toBe("at-risk");
  expect(projectMission(game, projection).status).toBe("loss");
});

const metrics: RuleObjective[] = [
  {
    id: "retain",
    label: "Retain customers",
    metric: "customerRetention",
    deadlineMonth: 3,
    minRetainedShare: 0.8,
  },
  {
    id: "budget",
    label: "Limit emissions",
    metric: "emissionsBudget",
    fromMonth: 1,
    throughMonth: 3,
    budgetTonnesCO2e: 1,
  },
  {
    id: "intensity",
    label: "Limit intensity",
    metric: "emissionsPerDeliveredMWh",
    fromMonth: 1,
    throughMonth: 3,
    maxKgCO2ePerMWh: 100,
  },
  {
    id: "local",
    label: "Deliver local wind",
    metric: "localFuelShare",
    fromMonth: 1,
    throughMonth: 3,
    fuels: ["Wind"],
    minShare: 0.5,
  },
  {
    id: "retire",
    label: "Retire coal",
    metric: "fuelRetirement",
    deadlineMonth: 1,
    fuel: "Coal",
  },
  {
    id: "bills",
    label: "Limit bills",
    metric: "monthlyBilledRate",
    fromMonth: 1,
    throughMonth: 3,
    maxDollarsPerKWh: 0.2,
  },
  {
    id: "debt",
    label: "Limit debt",
    metric: "monthEndDebt",
    fromMonth: 1,
    throughMonth: 3,
    maxDebtDollars: 100,
  },
];
it.each(metrics)(
  "forecasts $metric through the canonical evaluator",
  (objective) => {
    const { game, projection } = fixture([objective]);
    projection.objectiveAssets = [0, 1, 2, 3, 4, 5].map((month) => ({
      month,
      ownedFuels: {},
      debtPrincipal: 0,
    }));
    expect(goal(game, projection, objective.id).status).toBe("on-track");
    switch (objective.metric) {
      case "customerRetention":
        projection.financeProjected[2].customers = 799;
        break;
      case "emissionsBudget":
        projection.financeProjected[0].kgco2e = 1001;
        break;
      case "emissionsPerDeliveredMWh":
        projection.financeProjected.forEach((row) => {
          row.kgco2e = 101;
        });
        break;
      case "localFuelShare":
        projection.financeProjected.forEach((row) => {
          row.deliveredWhByFuel = { Coal: 1e6 };
        });
        break;
      case "fuelRetirement":
        projection.objectiveAssets[0].ownedFuels = { Coal: 1 };
        break;
      case "monthlyBilledRate":
        projection.financeProjected[0].revenue = 1000;
        break;
      case "monthEndDebt":
        projection.objectiveAssets[0].debtPrincipal = 1000;
        break;
    }
    // A fresh forecast replaces the memoized plan, as it does after a player decision.
    expect(goal(game, cloneDeep(projection), objective.id).status).toBe(
      "at-risk",
    );
  },
);

it("collects forecast loan and ownership facts from a private fleet without changing the game", () => {
  const { game } = fixture(metrics.slice(-1));
  game.facilities[0].loanAmountLeft = 1000;
  game.facilities[0].loanMonthlyPayment = 100;
  const before = cloneDeep(game);
  const projection = selectProjection(game, game.timeline[0]);
  expect(projection.objectiveAssets![0].debtPrincipal).toBeLessThan(
    getTotalDebt(game.facilities),
  );
  expect(projection.objectiveAssets![0].ownedFuels).toHaveProperty(
    game.facilities[0].fuel!,
  );
  expect(game).toEqual(before);
  for (const generate of [generateNewTimeline, generateForecastTimeline]) {
    const observed: number[] = [];
    generate(game, game.timeline[0].cash, 1000, 2, 60, (_state, tick) =>
      observed.push(tick.minute),
    );
    expect(observed).toEqual([0, 60]);
  }
});
