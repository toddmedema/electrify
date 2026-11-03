import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import { bestReachableCustomers, nextCustomerCount } from "./Customers";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { TICKS_PER_MONTH } from "../Constants";
import {
  decidedObjectiveFailure,
  formatRequiredShare,
  hasChronicBlackouts,
  retentionBaseline,
  scenarioObjectiveFailure,
  runFailure,
} from "./ObjectiveRules";

const scenario = (id: number): ScenarioType =>
  SCENARIOS.find((candidate) => candidate.id === id)!;
const row = (
  year: number,
  month: number,
  served: number,
  customers = 1000,
): MonthlyHistoryType =>
  ({
    year,
    month,
    demandWh: 1000,
    supplyWh: 1000 * served,
    customers,
  }) as MonthlyHistoryType;

it.each([
  ["Intern", 0.9],
  ["Employee", 0.95],
  ["Manager", 0.97],
  ["VP", 0.99],
  ["CEO", 0.995],
] as const)(
  "fires below the completed-month threshold on %s",
  (difficulty, threshold) => {
    const rows = (served: number) =>
      [3, 2, 1].map((month) => row(2026, month, served));
    expect(hasChronicBlackouts(rows(threshold - 0.001), difficulty)).toBe(true);
    expect(hasChronicBlackouts(rows(threshold), difficulty)).toBe(false);
    expect(
      hasChronicBlackouts(
        [rows(0.8)[0], row(2026, 2, threshold), rows(0.8)[2]],
        difficulty,
      ),
    ).toBe(false);
    expect(
      hasChronicBlackouts(
        [row(2026, 4, 0.8), row(2026, 2, 0.8), row(2026, 1, 0.8)],
        difficulty,
      ),
    ).toBe(false);
    expect(
      hasChronicBlackouts(
        [row(2026, 1, 0.8), row(2025, 12, 0.8), row(2025, 11, 0.8)],
        difficulty,
      ),
    ).toBe(true);
    expect(hasChronicBlackouts(rows(0.8).slice(0, 2), difficulty)).toBe(false);
    expect(
      hasChronicBlackouts([row(2026, 4, 1), ...rows(0.8)], difficulty),
    ).toBe(false);
    expect(
      hasChronicBlackouts(
        rows(0).map((month) => ({ ...month, demandWh: 0 })),
        difficulty,
      ),
    ).toBe(false);
  },
);

it("requires 80% retention without requiring a grid investment", () => {
  expect(
    scenarioObjectiveFailure(scenario(100), [row(2031, 12, 1, 799)], 1000),
  ).toMatch(/customers/);
  expect(
    scenarioObjectiveFailure(scenario(100), [row(2031, 12, 1, 800)], 1000),
  ).toBeUndefined();
  expect(
    scenarioObjectiveFailure(scenario(100), [row(2031, 12, 1, 1000)], 1000),
  ).toBeUndefined();
});

describe("best reachable customers", () => {
  it("grows a public utility only organically", () => {
    expect(bestReachableCustomers(1000, 12, "Public")).toBeCloseTo(1015.113, 3);
    expect(bestReachableCustomers(1000, 0, "Public")).toBe(1000);
  });

  it("lets an investor win back the unserved market, up to its size", () => {
    const recovered = bestReachableCustomers(100, 24, "Investor", 2000);
    expect(recovered).toBeGreaterThan(900);
    expect(recovered).toBeLessThan(2000 * 1.015 * 1.015);
  });
});

describe("decided objectives", () => {
  it("fails retention once even best-case public growth cannot reach it", () => {
    const dataCenters = scenario(106);
    const start = dataCenters.startingCustomers!;
    const threshold = start * dataCenters.minimumCustomerRetention!;
    const progress = { startingCustomers: start, monthsRemaining: 84 };
    const sevenYears = bestReachableCustomers(1, 84, "Public");
    const unreachable = Math.floor(threshold / sevenYears) - 10;
    expect(
      decidedObjectiveFailure(
        dataCenters,
        [row(2029, 1, 1, unreachable)],
        progress,
      ),
    ).toMatch(/Even the fastest possible growth/);
    const recoverable = Math.ceil(threshold / sevenYears) + 10;
    expect(
      decidedObjectiveFailure(
        dataCenters,
        [row(2029, 1, 1, recoverable)],
        progress,
      ),
    ).toBeUndefined();
  });

  it("never applies the term-end decision gate early", () => {
    expect(
      decidedObjectiveFailure(scenario(100), [row(2020, 1, 1)], {
        monthsRemaining: 100,
      }),
    ).toBeUndefined();
  });
});

describe("retention baseline", () => {
  it("prefers the authored count and otherwise uses the run's own start", () => {
    expect(retentionBaseline(scenario(106), 1)).toBe(16500);
    const investor = { ...scenario(100), minimumCustomerRetention: 0.5 };
    expect(retentionBaseline(investor, 2_000_000)).toBe(1_000_000);
    expect(
      retentionBaseline(
        { ...scenario(100), minimumCustomerRetention: undefined },
        2_000_000,
      ),
    ).toBeUndefined();
    expect(
      scenarioObjectiveFailure(
        investor,
        [row(2031, 12, 1, 400_000)],
        1_000_000,
      ),
    ).toMatch(/only 40% of the customers/);
  });
});

describe("required share formatting", () => {
  it("keeps a decimal only when the requirement has one", () => {
    expect(formatRequiredShare(1)).toBe("100%");
    expect(formatRequiredShare(0.995)).toBe("99.5%");
    expect(formatRequiredShare(0.98)).toBe("98%");
  });
});

it("does not declare attainable public retention impossible", () => {
  let customers = 1000;
  for (let tick = 0; tick < 84 * TICKS_PER_MONTH; tick++) {
    customers = nextCustomerCount({
      customers,
      customerRate: 0.1,
      marketRate: 0.1,
      marketSize: 2000,
      ownership: "Public",
    });
  }
  expect(bestReachableCustomers(1000, 84, "Public")).toBeGreaterThanOrEqual(
    customers,
  );
  const recoverable = {
    ...scenario(106),
    startingCustomers: customers,
    minimumCustomerRetention: 1,
  };
  expect(
    decidedObjectiveFailure(recoverable, [row(2029, 1, 1, 1000)], {
      startingCustomers: customers,
      monthsRemaining: 84,
    }),
  ).toBeUndefined();
});

it.each([
  ["Intern", 0.9],
  ["Employee", 0.95],
  ["Manager", 0.97],
  ["VP", 0.99],
  ["CEO", 0.995],
] as const)(
  "applies the %s rule throughout every scenario",
  (difficulty, threshold) => {
    for (const target of [...SCENARIOS, DEFAULT_CUSTOM_SCENARIO]) {
      const history = [3, 2, 1].map((month) =>
        row(target.startingYear, month, threshold - 0.001, 1e6),
      );
      const game = {
        difficulty,
        customerMarketSize: 2e6,
        date: getDateFromMinute(3 * MINUTES_PER_MONTH, target.startingYear),
      };
      const now = { cash: 1e9, minute: game.date.minute };
      const failure = (months: MonthlyHistoryType[]) =>
        runFailure(game, target, months, now, !!target.tutorialSteps);
      expect(failure(history)).toMatchObject({
        outcome: "fired",
        title: "Fired!",
        reason: expect.stringContaining(`${threshold * 100}%`),
      });
      expect(failure(history.slice(0, 2))).toBeUndefined();
      expect(
        failure(
          history.map((month) => ({
            ...month,
            supplyWh: month.demandWh * threshold,
          })),
        ),
      ).toBeUndefined();
    }
  },
);
