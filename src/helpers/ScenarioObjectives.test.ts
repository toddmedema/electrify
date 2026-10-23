import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type {
  ObjectiveContext,
  ObjectiveMonthFacts,
  ObjectiveProgress,
} from "../data/ScenarioObjectives";
import {
  initEconomyFromCsv,
  getInflationIndex,
  getRateInflationIndex,
} from "../data/Economy";
import { EMPTY_HISTORY } from "./DateTime";
import { ruleDigest } from "./RuleIdentity";
import {
  createObjectiveProgress,
  evaluateScenarioObjectives,
  objectiveDefinition,
  recordObjectiveMonth,
  validObjectiveProgress,
  validObjectiveResult,
} from "./ScenarioObjectives";

const context = (patch: Partial<ObjectiveContext> = {}): ObjectiveContext => ({
  rulesDigest: ruleDigest("objective-test"),
  startingYear: 2020,
  seed: 42,
  durationMonths: 3,
  ownership: "Investor",
  completedMonths: 0,
  marketSize: 2000,
  ...patch,
});
const facts = (
  month: number,
  patch: Partial<ObjectiveMonthFacts["history"]> = {},
  extra: Partial<ObjectiveMonthFacts> = {},
): ObjectiveMonthFacts => ({
  month,
  history: {
    ...EMPTY_HISTORY,
    year: 2020 + Math.floor(month / 12),
    month: (month % 12) + 1,
    customers: 1000,
    supplyWh: 1e6,
    demandWh: 1e6,
    deliveredWhByFuel: { Wind: 1e6 },
    revenue: 200,
    ...patch,
  },
  debtPrincipal: 100,
  ownedFuels: {},
  ...extra,
});
function economy(inflation = 0) {
  initEconomyFromCsv(
    "month,year,prime,inflation\n" +
      Array.from({ length: 15 }, (_, offset) =>
        Array.from(
          { length: 12 },
          (_, month) => `${month + 1},${2020 + offset},4,${inflation}`,
        ).join("\n"),
      ).join("\n"),
  );
}
beforeEach(() => economy());

const objectives: CompiledRuleObjective[] = [
  {
    id: "reliable",
    label: "Serve demand",
    required: true,
    metric: "monthlyReliability",
    fromMonth: 0,
    throughMonth: 1,
    minDemandServedShare: 0.9,
  },
  {
    id: "retain",
    label: "Retain customers",
    required: true,
    metric: "customerRetention",
    deadlineMonth: 1,
    minRetainedShare: 0.8,
  },
  {
    id: "budget",
    label: "Limit total emissions",
    required: true,
    metric: "emissionsBudget",
    fromMonth: 0,
    throughMonth: 1,
    budgetKgCO2e: 100,
  },
  {
    id: "intensity",
    label: "Limit emissions intensity",
    required: true,
    metric: "emissionsPerDeliveredMWh",
    fromMonth: 0,
    throughMonth: 1,
    maxKgCO2ePerMWh: 100,
  },
  {
    id: "local",
    label: "Deliver local wind",
    required: true,
    metric: "localFuelShare",
    fromMonth: 0,
    throughMonth: 1,
    fuels: ["Wind"],
    minShare: 0.5,
  },
  {
    id: "retire",
    label: "Retire coal",
    required: true,
    metric: "fuelRetirement",
    deadlineMonth: 1,
    fuel: "Coal",
  },
  {
    id: "affordable",
    label: "Keep bills affordable",
    required: true,
    metric: "monthlyBilledRate",
    fromMonth: 0,
    throughMonth: 1,
    maxDollarsPerKWh: 0.2,
  },
  {
    id: "debt",
    label: "Limit month-close principal",
    required: true,
    metric: "monthEndDebt",
    fromMonth: 0,
    throughMonth: 1,
    maxDebt: 100,
  },
];
function evidence(
  objective: CompiledRuleObjective,
  rows: ObjectiveMonthFacts[],
  completedMonths = 3,
  contextPatch: Partial<ObjectiveContext> = {},
) {
  const config = context(contextPatch);
  let progress = createObjectiveProgress([objective], config, 1000);
  rows.forEach((row) => {
    progress = recordObjectiveMonth(progress, [objective], row, config);
  });
  return {
    progress,
    config: { ...config, completedMonths },
    result: evaluateScenarioObjectives([objective], progress, {
      ...config,
      completedMonths,
    })[0],
  };
}
function valueRows(objective: CompiledRuleObjective, value: number) {
  return [0, 1, 2].map((month) => {
    switch (objective.metric) {
      case "monthlyReliability":
        return facts(month, { supplyWh: 1e6 * value });
      case "customerRetention":
        return facts(month, { customers: 1000 * value });
      case "emissionsBudget":
        return facts(month, { kgco2e: value / 2 });
      case "emissionsPerDeliveredMWh":
        return facts(month, { kgco2e: value });
      case "localFuelShare":
        return facts(month, {
          deliveredWhByFuel: { Wind: 1e6 * value, Coal: 1e6 * (1 - value) },
        });
      case "fuelRetirement":
        return facts(month, {}, { ownedFuels: { Coal: value } });
      case "monthlyBilledRate":
        return facts(month, { revenue: 1000 * value });
      case "monthEndDebt":
        return facts(month, {}, { debtPrincipal: value });
      default:
        throw new Error("Unsupported objective fixture");
    }
  });
}
const thresholds = [0.9, 0.8, 100, 100, 0.5, 0, 0.2, 100];
const passing = [0.91, 0.81, 99.99, 99.99, 0.51, 0, 0.1999, 99.99];
const failing = [
  0.89999, 0.79999, 100.00001, 100.00001, 0.49999, 1, 0.200001, 100.00001,
];

it.each(
  objectives.map(
    (objective, index) => [objective.metric, objective, index] as const,
  ),
)(
  "%s uses exact thresholds and retains its verdict after a JSON save round trip",
  (_metric, objective, index) => {
    for (const value of [passing[index], thresholds[index]]) {
      const { progress, config, result } = evidence(
        objective,
        valueRows(objective, value),
      );
      expect(result.status).toBe("completed");
      expect(result.observed).toBeCloseTo(value, 10);
      expect(result.observedMonths).toBe(result.requiredMonths);
      expect(validObjectiveProgress(progress, [objective], config)).toBe(true);
      expect(validObjectiveResult(result)).toBe(true);
      const restored = JSON.parse(JSON.stringify(progress));
      expect(
        evaluateScenarioObjectives([objective], restored, config)[0],
      ).toEqual(result);
    }
    expect(
      evidence(objective, valueRows(objective, failing[index])).result.status,
    ).toBe("failed");
  },
);

it.each(objectives)(
  "$metric never passes empty, incomplete or duplicate required history",
  (objective) => {
    const index = objectives.indexOf(objective);
    const rows = valueRows(objective, thresholds[index]);
    expect(evidence(objective, []).result.status).toBe("unverifiable");
    const missing =
      objective.metric === "fuelRetirement"
        ? rows.slice(0, 2)
        : rows.filter((row) => row.month !== 1);
    expect(evidence(objective, missing).result.status).toBe("unverifiable");
    const duplicate = evidence(objective, [...rows, rows[1]]);
    expect(duplicate.result.status).toBe("unverifiable");
    expect(
      validObjectiveProgress(duplicate.progress, [objective], duplicate.config),
    ).toBe(true);
  },
);

it("leaves recoverable average and share windows in progress, then uses weighted totals", () => {
  const intensity = objectives[3],
    share = objectives[4];
  expect(
    evidence(intensity, [facts(0, { kgco2e: 1000 })], 1).result.status,
  ).toBe("inProgress");
  expect(
    evidence(share, [facts(0, { deliveredWhByFuel: { Coal: 1e6 } })], 1).result
      .status,
  ).toBe("inProgress");
  const rows = [
    facts(0, { supplyWh: 1e6, kgco2e: 100, deliveredWhByFuel: { Wind: 1e6 } }),
    facts(1, { supplyWh: 9e6, kgco2e: 0, deliveredWhByFuel: { Coal: 9e6 } }),
  ];
  expect(evidence(intensity, rows).result).toMatchObject({
    status: "completed",
    observed: 10,
  });
  expect(evidence(share, rows).result).toMatchObject({
    status: "failed",
    observed: 0.1,
  });
  expect(evidence(intensity, [rows[0]], 3).result.status).toBe("unverifiable");
  expect(evidence(share, [rows[1]], 3).result.status).toBe("unverifiable");
});

it.each([objectives[0], objectives[3], objectives[4], objectives[6]])(
  "$metric makes an empty denominator unavailable",
  (objective) => {
    const rows = [
      facts(0, { supplyWh: 0, demandWh: 0, deliveredWhByFuel: {} }),
      facts(1, { supplyWh: 0, demandWh: 0, deliveredWhByFuel: {} }),
    ];
    expect(evidence(objective, rows).result.status).toBe("unverifiable");
  },
);

it("allows a zero-delivery month in a window ratio when the summed denominator is known and positive", () => {
  const empty = facts(0, { kgco2e: 50, supplyWh: 0, deliveredWhByFuel: {} });
  const delivered = facts(1, { kgco2e: 50 });
  expect(evidence(objectives[3], [empty, delivered]).result).toMatchObject({
    status: "completed",
    observed: 100,
  });
  expect(evidence(objectives[4], [empty, delivered]).result).toMatchObject({
    status: "completed",
    observed: 1,
  });
});

it("fails irrevocable reliability, expense, principal, budget and retirement violations before term end", () => {
  for (const index of [0, 2, 6, 7]) {
    const objective = objectives[index];
    const rows = valueRows(objective, failing[index]);
    if (objective.metric === "emissionsBudget") rows[0].history.kgco2e = 101;
    expect(evidence(objective, [rows[0]], 1).result.status).toBe("failed");
  }
  expect(
    evidence(objectives[5], [facts(0, {}, { ownedFuels: { Coal: 5 } })], 1)
      .result.status,
  ).toBe("pending");
  expect(
    evidence(objectives[5], [facts(1, {}, { ownedFuels: { Coal: 1 } })], 2)
      .result.status,
  ).toBe("failed");
  expect(evidence(objectives[5], [facts(1)], 2).result.status).toBe(
    "inProgress",
  );
});

it("keeps retirement obligations after the deadline and never infers missing ownership facts", () => {
  const objective = objectives[5];
  expect(
    evidence(objective, [facts(1), facts(2, {}, { ownedFuels: { Coal: 1 } })])
      .result.status,
  ).toBe("failed");
  expect(
    evidence(objective, [facts(1, {}, { ownedFuels: undefined }), facts(2)])
      .result.status,
  ).toBe("unverifiable");
});

it("uses completed customers and the ownership-aware upper bound before the retention deadline", () => {
  const retention: CompiledRuleObjective = {
    ...objectives[1],
    deadlineMonth: 23,
  } as CompiledRuleObjective;
  const investor = evidence(retention, [facts(0, { customers: 100 })], 1, {
    durationMonths: 24,
  });
  expect(investor.result.status).toBe("inProgress");
  const publicGrid = evidence(retention, [facts(0, { customers: 100 })], 1, {
    durationMonths: 24,
    ownership: "Public",
  });
  expect(publicGrid.result.status).toBe("failed");
  expect(publicGrid.result.reason).toMatch(/fastest possible growth/);
  const missingDeadline = evidence(
    retention,
    [facts(0, { customers: 100 })],
    24,
    { durationMonths: 24 },
  );
  expect(missingDeadline.result.status).toBe("unverifiable");
  const zeroBaseline = createObjectiveProgress(
    [retention],
    context({ durationMonths: 24 }),
    0,
  );
  const recorded = recordObjectiveMonth(
    zeroBaseline,
    [retention],
    facts(23),
    context({ durationMonths: 24 }),
  );
  expect(
    evaluateScenarioObjectives(
      [retention],
      recorded,
      context({ durationMonths: 24, completedMonths: 24 }),
    )[0].status,
  ).toBe("unverifiable");
});

it("counts total emissions once and uses customer sales rather than grants, exports or the tariff slider", () => {
  const rows = [0, 1].map((month) =>
    facts(month, {
      kgco2e: 50,
      localKgco2e: 20,
      importedKgco2e: 20,
      constructionKgco2e: 10,
      revenue: 1000200,
      revenueGrants: 900000,
      revenueExports: 100000,
    }),
  );
  expect(evidence(objectives[2], rows).result).toMatchObject({
    status: "completed",
    observed: 100,
  });
  expect(evidence(objectives[6], rows).result).toMatchObject({
    status: "completed",
    observed: 0.2,
  });
});

it("deflates bills with the billing-year index and principal with monthly CPI, including future years", () => {
  economy(0.12);
  const billed: CompiledRuleObjective = {
    ...objectives[6],
    fromMonth: 13,
    throughMonth: 13,
  } as CompiledRuleObjective;
  const debt: CompiledRuleObjective = {
    ...objectives[7],
    fromMonth: 13,
    throughMonth: 13,
  } as CompiledRuleObjective;
  const date = { year: 2021, monthNumber: 2 };
  const rateIndex = getRateInflationIndex(date, 2020, 42),
    debtIndex = getInflationIndex(date, 2020, 42);
  expect(debtIndex).toBeGreaterThan(rateIndex);
  const row = facts(
    13,
    { revenue: 200 * rateIndex, expensesInterest: 999999 },
    { debtPrincipal: 100 * debtIndex },
  );
  expect(
    evidence(billed, [row], 14, { durationMonths: 24 }).result.observed,
  ).toBeCloseTo(0.2, 12);
  expect(
    evidence(debt, [row], 14, { durationMonths: 24 }).result.observed,
  ).toBeCloseTo(100, 12);
  expect(
    evidence(
      debt,
      [facts(13, { expensesInterest: 0 }, { debtPrincipal: undefined })],
      14,
      { durationMonths: 24 },
    ).result.status,
  ).toBe("unverifiable");
});

it("retains 1200 months in bounded compact facts after all original monthly rows are discarded", () => {
  const objective: CompiledRuleObjective = {
    ...objectives[0],
    throughMonth: 1199,
  } as CompiledRuleObjective;
  const config = context({ durationMonths: 1200 });
  let progress = createObjectiveProgress([objective], config, 1000);
  for (let month = 0; month < 1200; month++)
    progress = recordObjectiveMonth(
      progress,
      [objective],
      facts(month),
      config,
    );
  const restored = JSON.parse(JSON.stringify(progress));
  const end = { ...config, completedMonths: 1200 };
  expect(restored.entries[0].observations).toHaveLength(1200);
  expect(JSON.stringify(restored).length).toBeLessThan(40000);
  expect(validObjectiveProgress(restored, [objective], end)).toBe(true);
  expect(
    evaluateScenarioObjectives([objective], restored, end)[0],
  ).toMatchObject({ status: "completed", observedMonths: 1200 });
});

it("binds progress to the resolved definitions and rejects altered facts, counters, baseline, checksum or metadata", () => {
  const objective = objectives[0];
  const { progress, config } = evidence(objective, valueRows(objective, 1));
  const mutations: ((value: ObjectiveProgress) => void)[] = [
    (value) => {
      value.entries[0].observations[0][1] = 1;
    },
    (value) => {
      value.completedMonths = 2;
    },
    (value) => {
      value.retentionBaseline = 2000;
    },
    (value) => {
      value.entries[0].observations.reverse();
    },
    (value) => {
      value.entries[0].observations.push([0, 1, 1]);
    },
    (value) => {
      value.entries[0].observations[0][1] = Infinity;
    },
    (value) => {
      value.checksum = "0".repeat(64);
    },
    (value) => {
      Object.assign(value.entries[0], { expression: "cash * 2" });
    },
  ];
  for (const mutate of mutations) {
    const changed = JSON.parse(JSON.stringify(progress));
    mutate(changed);
    expect(validObjectiveProgress(changed, [objective], config)).toBe(false);
  }
  expect(
    validObjectiveProgress(
      progress,
      [{ ...objective, minDemandServedShare: 0.99 } as CompiledRuleObjective],
      config,
    ),
  ).toBe(false);
  expect(
    validObjectiveProgress(progress, [objective], {
      ...config,
      rulesDigest: ruleDigest("changed"),
    }),
  ).toBe(false);
  expect(validObjectiveProgress(progress, [objective], config)).toBe(true);
});

it("validates result identity, units, generated definitions and safe metadata without trusting author text", () => {
  const objective = { ...objectives[6], required: false };
  const { result } = evidence(objective, valueRows(objective, 0.2));
  expect(result.required).toBe(false);
  expect(result.definition).toBe(objectiveDefinition("monthlyBilledRate"));
  expect(result.definition).toMatch(/excluding grants and exports/);
  expect(validObjectiveResult(result)).toBe(true);
  for (const patch of [
    { target: 999 },
    { definition: "Free electricity" },
    { observed: Infinity },
    { observedMonths: 5 },
    { observedMonths: 0 },
    { observedMonths: 1, requiredMonths: 1 },
    { reason: "<script>bad</script>" },
    { expression: "x" },
    { objective: { ...objective, maxDebt: 1 } },
  ]) {
    expect(validObjectiveResult({ ...result, ...patch })).toBe(false);
  }
});

it("treats a misplaced calendar row as unavailable and ignores forecast-month evidence", () => {
  const objective = objectives[0];
  const wrong = facts(0, { month: 2 });
  expect(evidence(objective, [wrong, facts(1)]).result.status).toBe(
    "unverifiable",
  );
  const { progress } = evidence(objective, [facts(0), facts(1)]);
  expect(
    evaluateScenarioObjectives(
      [objective],
      progress,
      context({ completedMonths: 0 }),
    )[0],
  ).toMatchObject({ status: "pending", observedMonths: 0 });
});

it("rejects overflowing saved facts and keeps nonfinite derived readings unavailable", () => {
  const rows = [
    facts(0, { kgco2e: Number.MAX_VALUE }),
    facts(1, { kgco2e: Number.MAX_VALUE }),
  ];
  const budget = evidence(objectives[2], rows, 2);
  expect(budget.result).toMatchObject({ status: "unverifiable" });
  expect(budget.result.observed).toBeUndefined();
  expect(
    validObjectiveProgress(budget.progress, [objectives[2]], budget.config),
  ).toBe(false);
  const ratio = evidence(
    objectives[0],
    [
      facts(0, { supplyWh: Number.MAX_VALUE, demandWh: Number.MIN_VALUE }),
      facts(1),
    ],
    2,
  );
  expect(ratio.result.status).toBe("unverifiable");
  expect(ratio.result.observed).toBe(1);
  expect(
    validObjectiveProgress(ratio.progress, [objectives[0]], ratio.config),
  ).toBe(false);
});

it("rejects a forged completed result below a minimum or above a ceiling while retaining valid neighbors", () => {
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const objective = objectives[index];
    const completed = evidence(
      objective,
      valueRows(objective, thresholds[index]),
    ).result;
    expect(validObjectiveResult(completed)).toBe(true);
    expect(
      validObjectiveResult({ ...completed, observed: failing[index] }),
    ).toBe(false);
    const failed = evidence(
      objective,
      valueRows(objective, failing[index]),
    ).result;
    expect(validObjectiveResult(failed)).toBe(true);
  }
});
