import {
  MAX_FUEL_SHARE_PIVOTS,
  requiredFuelShareFeasibility,
} from "./ScenarioFuelShares";
import { RULE_FUELS, RULE_LIMITS } from "./ScenarioRulesSchema";
import type { FuelNameType } from "../Types";

const triangle = (values: readonly number[]) => [
  {
    id: "a",
    fuels: ["Coal", "Natural Gas"] as FuelNameType[],
    minShare: values[0],
  },
  {
    id: "b",
    fuels: ["Natural Gas", "Uranium"] as FuelNameType[],
    minShare: values[1],
  },
  {
    id: "c",
    fuels: ["Coal", "Uranium"] as FuelNameType[],
    minShare: values[2],
  },
];

test("proves infeasible overlapping shares and accepts exact and nonuniform feasible neighbors", () => {
  expect(requiredFuelShareFeasibility(triangle([0.8, 0.8, 0.8])).status).toBe(
    "infeasible",
  );
  expect(
    requiredFuelShareFeasibility(triangle([2 / 3, 2 / 3, 2 / 3])).status,
  ).toBe("feasible");
  expect(
    requiredFuelShareFeasibility(
      triangle([2 / 3 + 1e-8, 2 / 3 + 1e-8, 2 / 3 + 1e-8]),
    ).status,
  ).toBe("infeasible");
  expect(requiredFuelShareFeasibility(triangle([0.9, 0.7, 0.4])).status).toBe(
    "feasible",
  );
  const fuels: FuelNameType[] = ["Coal", "Natural Gas", "Uranium", "Wind"];
  const triples = (target: number) =>
    fuels.map((fuel, index) => ({
      id: `goal-${index}`,
      fuels: fuels.filter((other) => other !== fuel),
      minShare: target,
    }));
  expect(requiredFuelShareFeasibility(triples(0.8)).status).toBe("infeasible");
  expect(requiredFuelShareFeasibility(triples(0.75)).status).toBe("feasible");
});

test("handles maximum-size, duplicate-set, degenerate and zero-share cases deterministically", () => {
  const requirements = Array.from(
    { length: RULE_LIMITS.objectives },
    (_, index) => ({
      id: `goal-${index}`,
      fuels: [...RULE_FUELS],
      minShare: index / (RULE_LIMITS.objectives - 1),
    }),
  );
  const forward = requiredFuelShareFeasibility(requirements);
  expect(forward.status).toBe("feasible");
  expect(forward.pivots).toBeLessThanOrEqual(MAX_FUEL_SHARE_PIVOTS);
  expect(requiredFuelShareFeasibility([...requirements].reverse())).toEqual(
    forward,
  );
  expect(
    requiredFuelShareFeasibility(
      requirements.map((goal) => ({ ...goal, minShare: 0 })),
    ),
  ).toEqual({ status: "feasible", pivots: 0 });
  expect(
    requiredFuelShareFeasibility(
      RULE_FUELS.map((fuel, index) => ({
        id: `fuel-${index}`,
        fuels: [fuel],
        minShare: 1 / RULE_FUELS.length + 1e-5,
      })),
    ).status,
  ).toBe("infeasible");
});

test("returns an analysis limit rather than a contradiction when bounded work is unavailable", () => {
  expect(requiredFuelShareFeasibility(triangle([0.8, 0.8, 0.8]), 0)).toEqual({
    status: "unverifiable",
    pivots: 0,
  });
  expect(
    requiredFuelShareFeasibility(triangle([2 / 3, 2 / 3, 2 / 3]), 0),
  ).toEqual({ status: "unverifiable", pivots: 0 });
  expect(
    requiredFuelShareFeasibility(
      Array.from({ length: RULE_LIMITS.objectives + 1 }, (_, index) => ({
        id: `goal-${index}`,
        fuels: ["Coal"] as FuelNameType[],
        minShare: 0,
      })),
    ).status,
  ).toBe("unverifiable");
});

test("agrees with an independent complete rational grid for three-fuel subset targets", () => {
  const fuels: FuelNameType[] = ["Coal", "Natural Gas", "Uranium"];
  // With total mass1, a nontrivial three-fuel subset is a coordinate lower bound or
  // its complementary upper bound. Quarter-unit bounds have a quarter-grid feasible vertex.
  const allocations: number[][] = [];
  for (let a = 0; a <= 4; a++)
    for (let b = 0; b <= 4 - a; b++)
      allocations.push([a / 4, b / 4, (4 - a - b) / 4]);
  for (let sample = 0; sample < 512; sample++) {
    const requirements = Array.from({ length: 4 }, (_, index) => {
      const mask = ((sample * 3 + index * 5) % 7) + 1;
      return {
        id: `goal-${index}`,
        fuels: fuels.filter((_, fuel) => (mask & (1 << fuel)) !== 0),
        minShare: ((sample >> (index * 2)) % 5) / 4,
      };
    });
    const possible = allocations.some((allocation) =>
      requirements.every(
        (goal) =>
          goal.fuels.reduce(
            (sum, fuel) => sum + allocation[fuels.indexOf(fuel)],
            0,
          ) >= goal.minShare,
      ),
    );
    expect({
      sample,
      status: requiredFuelShareFeasibility(requirements).status,
    }).toEqual({ sample, status: possible ? "feasible" : "infeasible" });
  }
});

test("accepts maximum-domain goals generated from real feasible witnesses within bounded work", () => {
  let state = 0x605;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  let maximumPivots = 0;
  for (let sample = 0; sample < 512; sample++) {
    const weights = RULE_FUELS.map(() => (next() % 17) + 1);
    const total = weights.reduce((sum, value) => sum + value, 0);
    const requirements = Array.from(
      { length: RULE_LIMITS.objectives },
      (_, index) => {
        const mask = (next() % ((1 << RULE_FUELS.length) - 1)) + 1;
        const fuels = RULE_FUELS.filter(
          (_, fuel) => (mask & (1 << fuel)) !== 0,
        );
        const minShare = RULE_FUELS.reduce(
          (sum, fuel, fuelIndex) =>
            sum + (fuels.includes(fuel) ? weights[fuelIndex] / total : 0),
          0,
        );
        return { id: `goal-${index}`, fuels, minShare };
      },
    );
    const result = requiredFuelShareFeasibility(requirements);
    expect({ sample, status: result.status }).toEqual({
      sample,
      status: "feasible",
    });
    maximumPivots = Math.max(maximumPivots, result.pivots);
  }
  expect(maximumPivots).toBeLessThanOrEqual(MAX_FUEL_SHARE_PIVOTS);
});
