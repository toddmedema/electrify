import { SCENARIOS } from "../data/Scenarios";
import { runSimulation } from "../testing/Simulator";
import { MonthlyHistoryType, ScenarioType } from "../Types";
import { bestReachableCustomers, nextCustomerCount } from "./Customers";
import { TICKS_PER_MONTH } from "../Constants";
import {
  decidedObjectiveFailure,
  formatRequiredShare,
  retentionBaseline,
  scenarioObjectiveFailure,
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
  it("ends a run as soon as a reliability month falls short", () => {
    const heatwave = scenario(108);
    const failedJuly = [row(2026, 7, 0.9)];
    const progress = { monthsRemaining: 5 };
    expect(decidedObjectiveFailure(heatwave, failedJuly, progress)).toBe(
      scenarioObjectiveFailure(heatwave, failedJuly),
    );
    expect(
      decidedObjectiveFailure(heatwave, [row(2026, 7, 1)], progress),
    ).toBeUndefined();
    // Months outside the window never decide anything
    expect(
      decidedObjectiveFailure(heatwave, [row(2026, 5, 0.5)], progress),
    ).toBeUndefined();
  });

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

describe("ending a run once its objective is decided", () => {
  it("ends a passive Deep Freeze right after the missed freeze month", () => {
    const passive = runSimulation({ scenarioId: 107, difficulty: "Employee" });
    expect(passive.outcome).toBe("fired");
    // February 2021 is month 49; its row completes at the month-50 rollover, not month 84
    expect(passive.firedAtMonth).toBe(50);
  }, 120000);
});

describe("tolerant full-demand objectives", () => {
  it("accepts a hair's shortfall but not a real one", () => {
    const heatwave = scenario(108);
    expect(heatwave.reliabilityObjective?.minimumDemandServed).toBe(0.995);
    expect(
      scenarioObjectiveFailure(heatwave, [row(2026, 7, 0.9996)]),
    ).toBeUndefined();
    expect(scenarioObjectiveFailure(heatwave, [row(2026, 7, 0.99)])).toMatch(
      /served 99\.00% .* requires 99\.5%\.$/,
    );
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
