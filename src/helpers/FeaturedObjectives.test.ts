import type {
  CompiledRuleObjective,
  RuleObjective,
} from "../data/ScenarioRules";
import type {
  ObjectiveContext,
  ObjectiveMonthFacts,
} from "../data/ScenarioObjectives";
import { EMPTY_HISTORY } from "./DateTime";
import { ruleDigest } from "./RuleIdentity";
import {
  compileScenarioRules,
  ruleDefinitionsFromSnapshot,
} from "./ScenarioRules";
import { ruleDiagnostics } from "./ScenarioRulesSchema";
import {
  objectiveGoalText,
  objectiveObservedText,
} from "./ObjectivePresentation";
import {
  createObjectiveProgress,
  evaluateScenarioObjectives,
  recordObjectiveMonth,
  validObjectiveProgress,
  validObjectiveResult,
} from "./ScenarioObjectives";

const base = {
  id: "featured",
  label: "Featured goal",
  required: true,
  fromMonth: 0,
  throughMonth: 1,
};
const context: ObjectiveContext = {
  rulesDigest: ruleDigest("featured-goal-test"),
  startingYear: 2020,
  seed: 611,
  durationMonths: 2,
  ownership: "Investor",
  completedMonths: 0,
};
function facts(
  month: number,
  history: Partial<ObjectiveMonthFacts["history"]> = {},
  extra: Partial<ObjectiveMonthFacts> = {},
): ObjectiveMonthFacts {
  return {
    month,
    history: {
      ...EMPTY_HISTORY,
      year: 2020,
      month: month + 1,
      customers: 100,
      supplyWh: 100,
      demandWh: 100,
      ...history,
    },
    ...extra,
  };
}
function evaluate(
  goal: CompiledRuleObjective,
  rows: ObjectiveMonthFacts[],
  completedMonths = 2,
) {
  let progress = createObjectiveProgress([goal], context, 100);
  for (const row of rows)
    progress = recordObjectiveMonth(progress, [goal], row, context);
  const closed = { ...context, completedMonths };
  const restored = JSON.parse(JSON.stringify(progress));
  expect(validObjectiveProgress(restored, [goal], closed)).toBe(true);
  const result = evaluateScenarioObjectives([goal], restored, closed)[0];
  expect(validObjectiveResult(result)).toBe(true);
  return { result, progress: restored, closed };
}

it("measures aggregate revenue coverage and excludes grants instead of treating starting cash as profit", () => {
  const goal: CompiledRuleObjective = {
    ...base,
    metric: "financialCoverage",
    basis: "revenue",
    minCoverage: 1,
  };
  const rows = [
    facts(0, { revenue: 10, expensesFuel: 100 }),
    facts(1, {
      revenue: 1100,
      revenueGrants: 100,
      expensesFuel: 800,
      expensesImports: 100,
      cash: 1e12,
    }),
  ];
  expect(evaluate(goal, rows).result).toMatchObject({
    status: "completed",
    observed: 1.01,
  });
  rows[1].history.revenueGrants = 200;
  expect(evaluate(goal, rows).result.status).toBe("failed");
  expect(evaluate(goal, [rows[0]], 1).result.status).toBe("inProgress");
});

it("requires operating cash coverage in every month and handles zero expense months finitely", () => {
  const goal: CompiledRuleObjective = {
    ...base,
    metric: "financialCoverage",
    basis: "cash",
    minCoverage: 1,
  };
  expect(
    evaluate(goal, [
      facts(0, { cash: 100, expensesFuel: 100 }),
      facts(1, { cash: 899, expensesFuel: 900 }),
    ]).result.status,
  ).toBe("failed");
  const free = [facts(0, { cash: 0 }), facts(1, { cash: 100 })];
  expect(evaluate(goal, free).result).toMatchObject({
    status: "completed",
    observed: 1,
  });
  expect(evaluate({ ...goal, basis: "revenue" }, free).result).toMatchObject({
    status: "completed",
    observed: 1,
  });
});

it("keeps overflowing financial evidence unavailable without emitting nonfinite debrief values", () => {
  const goal: CompiledRuleObjective = {
    ...base,
    metric: "financialCoverage",
    basis: "revenue",
    minCoverage: 1,
  };
  let progress = createObjectiveProgress([goal], context, 100);
  for (let month = 0; month < 2; month++)
    progress = recordObjectiveMonth(
      progress,
      [goal],
      facts(month, {
        revenue: Number.MAX_VALUE,
        expensesFuel: Number.MAX_VALUE,
      }),
      context,
    );
  const closed = { ...context, completedMonths: 2 };
  expect(validObjectiveProgress(progress, [goal], closed)).toBe(false);
  const result = evaluateScenarioObjectives([goal], progress, closed)[0];
  expect(result.status).toBe("unverifiable");
  expect(result.observed).toBeUndefined();
  expect(validObjectiveResult(result)).toBe(true);
});

it("judges customer growth at the deadline as an absolute count", () => {
  const goal: CompiledRuleObjective = {
    id: "growth",
    label: "Grow",
    required: true,
    metric: "customerCount",
    deadlineMonth: 1,
    minCustomers: 150,
  };
  const underway = evaluate(goal, [facts(0)], 1).result;
  expect(underway).toMatchObject({ status: "inProgress", observed: 100 });
  expect(objectiveObservedText(underway)).toBe("100 customers now");
  expect(
    evaluate(goal, [facts(0), facts(1, { customers: 150 })]).result,
  ).toMatchObject({ status: "completed", observed: 150 });
  expect(evaluate(goal, [facts(1, { customers: 149.999 })]).result.status).toBe(
    "failed",
  );
  expect(objectiveGoalText(goal, 2020, 2)).toBe(
    "Reach ≥150 customers by Feb 2020",
  );
});

it("requires reachable headroom every month and a shortage cannot become passing positive reserve", () => {
  const goal: CompiledRuleObjective = {
    ...base,
    metric: "reserveMargin",
    minReserveW: 10,
  };
  expect(
    evaluate(goal, [
      facts(0, { minimumSupplyMarginW: 10 }),
      facts(1, { minimumSupplyMarginW: 20 }),
    ]).result.status,
  ).toBe("completed");
  expect(
    evaluate(goal, [
      facts(0, { minimumSupplyMarginW: -1 }),
      facts(1, { minimumSupplyMarginW: 20 }),
    ]).result,
  ).toMatchObject({ status: "failed", observed: 0 });
  expect(evaluate(goal, [facts(0), facts(1)]).result.status).toBe(
    "unverifiable",
  );
});

it("weights efficiency by counterfactual eligible energy, including months the program is off", () => {
  const goal: CompiledRuleObjective = {
    ...base,
    metric: "efficiencySavings",
    minShare: 0.05,
  };
  const first = facts(0, { efficiencySavedWh: 10, efficiencyEligibleWh: 100 });
  expect(
    evaluate(goal, [
      first,
      facts(1, { efficiencySavedWh: 0, efficiencyEligibleWh: 900 }),
    ]).result,
  ).toMatchObject({ status: "failed", observed: 0.01 });
  expect(
    evaluate(goal, [
      first,
      facts(1, { efficiencySavedWh: 50, efficiencyEligibleWh: 900 }),
    ]).result.status,
  ).toBe("completed");
  expect(evaluate(goal, [facts(0), facts(1)]).result.status).toBe(
    "unverifiable",
  );
  expect(
    evaluate(
      goal,
      [0, 1].map((month) =>
        facts(month, { efficiencySavedWh: 0, efficiencyEligibleWh: 0 }),
      ),
    ).result.status,
  ).toBe("unverifiable");
});

it("measures evening service separately and never hides a bad month in a large annual total", () => {
  const all: CompiledRuleObjective = {
    ...base,
    metric: "demandServedShare",
    minShare: 0.995,
  };
  const evening: CompiledRuleObjective = { ...all, hours: [17, 21] };
  const rows = [
    facts(0, {
      supplyWh: 90,
      demandWh: 100,
      eveningDemandWh: 20,
      eveningUnservedWh: 0,
    }),
    facts(1, {
      supplyWh: 10000,
      demandWh: 10000,
      eveningDemandWh: 20,
      eveningUnservedWh: 0,
    }),
  ];
  expect(evaluate(all, rows).result).toMatchObject({
    status: "failed",
    observed: 0.9,
  });
  expect(evaluate(evening, rows).result.status).toBe("completed");
  rows[1].history.eveningUnservedWh = 1;
  expect(evaluate(evening, rows).result.status).toBe("failed");
  expect(
    evaluate(
      evening,
      [0, 1].map((month) =>
        facts(month, { eveningDemandWh: 0, eveningUnservedWh: 0 }),
      ),
    ).result,
  ).toMatchObject({ status: "completed", observed: 1 });
  expect(evaluate(evening, [facts(0), facts(1)]).result.status).toBe(
    "unverifiable",
  );
  expect(objectiveGoalText(evening, 2020, 2)).toContain("17:00–21:00");
});

it("retires the exact vintage cohort while allowing newer assets and rejects edited observations", () => {
  const goal: CompiledRuleObjective = {
    id: "retire",
    label: "Retire old oil",
    required: true,
    metric: "fuelRetirement",
    fuel: "Oil",
    deadlineMonth: 0,
    commissionedBeforeYear: 2001,
  };
  const rows = [0, 1].map((month) =>
    facts(
      month,
      {},
      {
        ownedFuels: { Oil: 2 },
        ownedVintageFuels: [
          { fuel: "Oil", commissionedBeforeYear: 2001, count: 0 },
        ],
      },
    ),
  );
  const checked = evaluate(goal, rows);
  expect(checked.result.status).toBe("completed");
  expect(checked.result.definition).toContain("commissioned before 2001");
  expect(checked.result.definition).toContain(
    "newer and unfinished equipment is excluded",
  );
  expect(objectiveObservedText(checked.result)).toContain(
    "commissioned before 2001",
  );
  rows[0].ownedVintageFuels![0].count = 1;
  expect(evaluate(goal, rows).result.status).toBe("failed");
  expect(
    evaluate(goal, [facts(0, {}, { ownedFuels: { Oil: 0 } }), rows[1]]).result
      .status,
  ).toBe("unverifiable");
  checked.progress.entries[0].observations[0][1] = 1;
  expect(validObjectiveProgress(checked.progress, [goal], checked.closed)).toBe(
    false,
  );
});

it("validates and round-trips all new author fields without accepting unsupported hour windows", () => {
  const goals: RuleObjective[] = [
    {
      id: "profit",
      label: "Profit",
      metric: "financialCoverage",
      basis: "revenue",
      minCoverage: 1,
      fromMonth: 1,
      throughMonth: 2,
    },
    {
      id: "cash",
      label: "Cash",
      metric: "financialCoverage",
      basis: "cash",
      minCoverage: 1,
      fromMonth: 1,
      throughMonth: 2,
    },
    {
      id: "customers",
      label: "Grow",
      metric: "customerCount",
      minCustomers: 150,
      deadlineMonth: 2,
    },
    {
      id: "reserve",
      label: "Headroom",
      metric: "reserveMargin",
      minReserveW: 10000,
      fromMonth: 1,
      throughMonth: 2,
    },
    {
      id: "save",
      label: "Save",
      metric: "efficiencySavings",
      minShare: 0.05,
      fromMonth: 1,
      throughMonth: 2,
    },
    {
      id: "evening",
      label: "Evening",
      metric: "demandServedShare",
      minShare: 0.995,
      hours: [17, 21],
      fromMonth: 1,
      throughMonth: 2,
    },
    {
      id: "retire",
      label: "Retire",
      metric: "fuelRetirement",
      fuel: "Oil",
      commissionedBeforeYear: 2001,
      deadlineMonth: 2,
    },
  ];
  const definitions = { objectives: goals };
  expect(ruleDiagnostics(definitions)).toEqual([]);
  const compiled = compileScenarioRules(definitions, {
    namespace: { kind: "mod", id: "featured-goals" },
    difficulty: "Manager",
    seed: 611,
    startingYear: 2020,
    durationMonths: 2,
    startingPeakW: 1e6,
    startingAssetIds: [],
  });
  expect(ruleDefinitionsFromSnapshot(compiled).objectives).toEqual(
    goals
      .map((goal) => ({ ...goal, required: true }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  );
  expect(
    ruleDiagnostics({ objectives: [{ ...goals[5], hours: [18, 22] }] }),
  ).not.toEqual([]);
  expect(
    ruleDiagnostics({ objectives: [{ ...goals[0], basis: "grants" }] }),
  ).not.toEqual([]);
  expect(
    ruleDiagnostics({
      objectives: [{ ...goals[6], commissionedBeforeYear: 2000.5 }],
    }),
  ).not.toEqual([]);
});
