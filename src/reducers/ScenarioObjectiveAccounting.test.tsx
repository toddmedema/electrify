import type { RuleObjective } from "../data/ScenarioRules";
import { TICK_MINUTES } from "../Constants";
import { getInflationIndex, getRateInflationIndex } from "../data/Economy";
import { getTotalDebt } from "../helpers/Financials";
import {
  bestReachableCustomers,
  customerMarketSizeAt,
} from "../helpers/Customers";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import {
  gameObjectiveResults,
  recordGameObjectiveMonth,
  runFailure,
} from "../helpers/ObjectiveRules";
import { getMissionStatus } from "../helpers/MissionStatus";
import {
  customerSalesRevenue,
  startingDollarRevenue,
} from "../helpers/Scoring";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { createGame, runSimulation } from "../testing/Simulator";

const pack = (startingYear = 2040): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "objective-accounting",
  title: "Objective accounting",
  creator: "Fixture",
  version: "1",
  description: "Observe customer bills and closing loan principal.",
  seed: 42,
  baseScenarioId: 101,
  officialArcs: [],
  objectives: { mode: "none" },
  scenario: {
    startingYear,
    durationMonths: 24,
    cash: 1e9,
    startingCustomers: 10000,
    dollarsPerkWh: 0.2,
  },
  events: [
    {
      id: "company-grant",
      title: "Company grant",
      message: "Company funding arrives.",
      preview: "Company funding will arrive.",
      startMonth: 13,
      durationMonths: 1,
      effects: {
        transactions: [{ kind: "grant", amountDollars: 500000000 }],
      },
    },
  ],
});
const simulate = (
  input: ModPackage,
  objective?: RuleObjective,
  financed = false,
) =>
  runSimulation({
    scenarioId: 999,
    scenario: modScenario(
      {
        ...input,
        objectives: objective
          ? { mode: "replace", items: [objective] }
          : { mode: "none" },
      },
      undefined,
      "Employee",
    ),
    difficulty: "Employee",
    seed: input.seed,
    months: financed ? 18 : 13,
    scheduledActions: [
      {
        month: 0,
        type: "intertie",
        corridorId: "california-north",
        financed,
      },
    ],
    ...(financed
      ? { initialBuild: { name: "Solar", peakW: 20000000, financed: true } }
      : {}),
    weatherHazardsEnabled: false,
  });

test.each([2020, 2040])(
  "billed-rate objectives use starting-%i customer dollars and exclude grants and exports",
  (startingYear) => {
    const input = pack(startingYear);
    const reference = simulate(input);
    expect(reference.violations).toEqual([]);
    const month = reference.months[12];
    expect(month.revenueGrants).toBe(500000000);
    expect(month.revenueExports).toBeGreaterThan(0);
    const deliveredKWh = month.supplyWh / 1000;
    const realRate =
      startingDollarRevenue([month], startingYear, input.seed) / deliveredKWh;
    const nominalRate = customerSalesRevenue(month) / deliveredKWh;
    expect(nominalRate).toBeGreaterThan(realRate * 1.005);
    const objective = (maxDollarsPerKWh: number): RuleObjective => ({
      id: "billed-rate",
      label: "Keep customer bills affordable",
      metric: "monthlyBilledRate",
      fromMonth: 13,
      throughMonth: 13,
      maxDollarsPerKWh,
    });
    const passing = simulate(input, objective((realRate + nominalRate) / 2));
    expect(passing.firedAtMonth).toBeNull();
    expect(passing.months[12]).toEqual(month);
    const failing = simulate(input, objective(realRate * 0.999));
    expect(failing.firedAtMonth).toBe(13);
    expect(failing.violations).toEqual([]);
  },
);

test("month-end debt uses actual outstanding principal in monthly starting-year dollars", () => {
  const input = pack();
  const reference = simulate(input, undefined, true);
  expect(reference.violations).toEqual([]);
  expect(reference.finalDebt).toBeGreaterThan(1000000);
  const month = reference.months[17];
  expect(month.expensesInterest).toBeLessThan(reference.finalDebt / 10);
  const date = { year: month.year, monthNumber: month.month };
  const monthlyIndex = getInflationIndex(date, 2040, input.seed);
  const annualBillingIndex = getRateInflationIndex(date, 2040, input.seed);
  expect(monthlyIndex).toBeGreaterThan(annualBillingIndex * 1.002);
  const realDebt = reference.finalDebt / monthlyIndex;
  const annuallyDeflatedDebt = reference.finalDebt / annualBillingIndex;
  const objective = (maxDebtDollars: number): RuleObjective => ({
    id: "debt-ceiling",
    label: "Keep closing principal affordable",
    metric: "monthEndDebt",
    fromMonth: 18,
    throughMonth: 18,
    maxDebtDollars,
  });
  // The threshold lies between monthly CPI and annual tariff repricing. Four opening
  // supply-settling frames follow the recorded close, so keep clear of that small difference.
  const passing = simulate(
    input,
    objective((realDebt + annuallyDeflatedDebt) / 2),
    true,
  );
  expect(passing.firedAtMonth).toBeNull();
  expect(passing.finalDebt).toBe(reference.finalDebt);
  const failing = simulate(input, objective(month.expensesInterest * 2), true);
  expect(failing.firedAtMonth).toBe(18);
  expect(failing.violations).toEqual([]);
  const plantDebt = getTotalDebt(reference.finalFacilities) / monthlyIndex;
  expect(realDebt).toBeGreaterThan(plantDebt * 2);
  const lineCeiling = simulate(
    input,
    objective((plantDebt + realDebt) / 2),
    true,
  );
  expect(lineCeiling.firedAtMonth).toBe(18);
  expect(lineCeiling.violations).toEqual([]);
});

test("retention uses one completed-month clock in live termination and Mission Status", () => {
  const input = pack(2020);
  input.events = [];
  input.scenario = {
    ...input.scenario,
    durationMonths: 6,
    startingCustomers: 1000,
  };
  const options = {
    scenarioId: 999,
    difficulty: "Employee" as const,
    seed: input.seed,
  };
  const reference = createGame({
    ...options,
    scenario: modScenario(input, undefined, options.difficulty),
  });
  const boundary = MINUTES_PER_MONTH;
  const closingFrame = boundary - TICK_MINUTES;
  const reachable = (minute: number) =>
    bestReachableCustomers(
      600,
      2,
      "Investor",
      customerMarketSizeAt(reference.customerMarketSize, minute),
    );
  const oldFrameLimit = reachable(closingFrame);
  const boundaryLimit = reachable(boundary);
  const threshold = (oldFrameLimit + boundaryLimit) / 2;
  expect(oldFrameLimit).toBeLessThan(threshold);
  expect(boundaryLimit).toBeGreaterThan(threshold);
  input.objectives = {
    mode: "replace",
    items: [
      {
        id: "retain-community",
        label: "Retain the community",
        metric: "customerRetention",
        deadlineMonth: 3,
        minRetainedShare: threshold / 1000,
      },
    ],
  };
  const scenario = modScenario(input, undefined, options.difficulty);
  const state = createGame({ ...options, scenario });
  state.date = getDateFromMinute(boundary, state.startingYear);
  const history = {
    ...EMPTY_HISTORY,
    year: 2020,
    month: 1,
    customers: 600,
    demandWh: 1e6,
    supplyWh: 1e6,
  };
  state.monthlyHistory = [history];
  recordGameObjectiveMonth(state, history);
  expect(gameObjectiveResults(state)[0].status).toBe("inProgress");
  expect(
    getMissionStatus(state).requirements.find(
      (requirement) => requirement.id === "retain-community",
    )?.status,
  ).toBe("in-progress");
  for (const minute of [closingFrame, boundary]) {
    expect(
      runFailure(
        state,
        scenario,
        state.monthlyHistory,
        { minute, cash: 1e9 },
        false,
      ),
    ).toBeUndefined();
  }
});
