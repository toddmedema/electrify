import { compileScenarioRules, RuleCompilationError } from "./ScenarioRules";
import type { RuleObjective } from "../data/ScenarioRules";

const parameters = {
  namespace: { kind: "mod" as const, id: "objective-guards" },
  difficulty: "Employee" as const,
  seed: 42,
  startingYear: 2020,
  durationMonths: 24,
  startingPeakW: 1e8,
  startingAssetIds: [],
};
const share = (
  id: string,
  fuels: Extract<RuleObjective, { metric: "localFuelShare" }>["fuels"],
  minShare: number,
  required = true,
): Extract<RuleObjective, { metric: "localFuelShare" }> => ({
  id,
  label: id,
  metric: "localFuelShare",
  fromMonth: 1,
  throughMonth: 12,
  fuels,
  minShare,
  required,
});

test("rejects provably contradictory required fuel shares while allowing optional competing goals", () => {
  const impossible = [
    share("coal", ["Coal"], 0.4),
    share("gas", ["Natural Gas"], 0.3),
    share("renewables", ["Sun", "Wind"], 0.4),
  ];
  expect(() =>
    compileScenarioRules({ objectives: impossible }, parameters),
  ).toThrow(/cannot all be met/);
  const valid = compileScenarioRules(
    {
      objectives: [
        ...impossible.slice(0, 2),
        share("renewables", ["Sun", "Wind"], 0.4, false),
      ],
    },
    parameters,
  );
  expect(valid.objectives).toHaveLength(3);
  expect(() =>
    compileScenarioRules(
      {
        objectives: [
          share("coal", ["Coal"], 0.4),
          share("gas", ["Natural Gas"], 0.3),
          share("renewables", ["Sun", "Wind"], 0.3),
        ],
      },
      parameters,
    ),
  ).not.toThrow();
});

test("keeps overlapping fuel sets and distinct windows separate instead of assuming a strategy", () => {
  expect(() =>
    compileScenarioRules(
      {
        objectives: [
          share("gas", ["Natural Gas"], 0.8),
          share("firm", ["Natural Gas", "Uranium"], 0.9),
        ],
      },
      parameters,
    ),
  ).not.toThrow();
  expect(() =>
    compileScenarioRules(
      {
        objectives: [
          share("coal", ["Coal"], 0.9),
          { ...share("wind", ["Wind"], 0.9), fromMonth: 13, throughMonth: 24 },
        ],
      },
      parameters,
    ),
  ).not.toThrow();
  expect(() =>
    compileScenarioRules(
      {
        objectives: [
          {
            id: "retire",
            label: "Retire coal at close",
            metric: "fuelRetirement",
            fuel: "Coal",
            deadlineMonth: 1,
          },
          share("coal", ["Coal"], 0.5),
        ],
      },
      parameters,
    ),
  ).not.toThrow();
});

test("reports independent invalid objective windows and rejects metric scope mismatches", () => {
  const late: RuleObjective[] = [
    {
      id: "debt",
      label: "Debt",
      metric: "monthEndDebt",
      fromMonth: 25,
      throughMonth: 26,
      maxDebtDollars: 0,
    },
    {
      id: "retire",
      label: "Retire",
      metric: "fuelRetirement",
      fuel: "Coal",
      deadlineMonth: 30,
    },
  ];
  let caught: unknown;
  try {
    compileScenarioRules({ objectives: late }, parameters);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(RuleCompilationError);
  expect(
    (caught as RuleCompilationError).diagnostics.filter(
      (diagnostic) => diagnostic.code === "outside-term",
    ),
  ).toHaveLength(3);
  expect(() =>
    compileScenarioRules(
      {
        objectives: [
          {
            ...share("coal", ["Coal"], 0.5),
            maxDebtDollars: 1,
          } as RuleObjective,
        ],
      },
      parameters,
    ),
  ).toThrow(/supported rule field/);
});

test("rejects overlapping fuel-share requirements that exceed any normalized fuel mix", () => {
  const triangle = (minimum: number, thirdRequired = true) => [
    share("coal-gas", ["Coal", "Natural Gas"], minimum),
    share("gas-nuclear", ["Natural Gas", "Uranium"], minimum),
    share("coal-nuclear", ["Coal", "Uranium"], minimum, thirdRequired),
  ];
  expect(() =>
    compileScenarioRules({ objectives: triangle(0.8) }, parameters),
  ).toThrow(/cannot all be met/);
  expect(() =>
    compileScenarioRules({ objectives: triangle(2 / 3) }, parameters),
  ).not.toThrow();
  expect(() =>
    compileScenarioRules({ objectives: triangle(0.8, false) }, parameters),
  ).not.toThrow();
});
