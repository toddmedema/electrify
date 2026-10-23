import { ruleChoices } from "../helpers/ScenarioRuleDependencies";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  MOD_EXAMPLE_IDS,
  ModExampleId,
  modExampleBranches,
  modExampleRoute,
  modExampleScenario,
  readModExample,
} from "./ModExampleFixtures";
import { runSimulation } from "./Simulator";
import type { SimResultType } from "./Simulator";

jest.setTimeout(120000);

function checkBranchFacts(
  id: ModExampleId,
  responses: Record<string, string>,
  result: SimResultType,
) {
  const receipt = (suffix: string) => {
    const found = result.storyOccurrences.find((event) =>
      event.key.endsWith(suffix),
    );
    expect(found).toBeDefined();
    return found!;
  };
  const grants = result.months.reduce(
    (total, month) => total + month.revenueGrants,
    0,
  );
  switch (id) {
    case "funded-or-phased-connection": {
      const funded = Object.values(responses).includes("fast-track");
      expect(receipt(":choice:connection").attributes).toMatchObject({
        cost: 0,
        upfrontGrant: funded ? 15000000 : 0,
      });
      expect(grants).toBe(funded ? 15000000 : 0);
      break;
    }
    case "two-dry-years": {
      let expectedGrants = 0;
      for (const [year, onset, amount, inflow] of [
        ["first", 12, 5000000, 0.5],
        ["second", 24, 3000000, 0.25],
      ] as const) {
        const conserved =
          responses[`mod:${id}:${year}-year-response`] === "conserve";
        expect(receipt(`:${year}-year-response`).attributes).toMatchObject({
          cost: conserved ? amount : 0,
          upfrontGrant: conserved ? 0 : amount,
        });
        expectedGrants += conserved ? 0 : amount;
        const dry = receipt(`:${year}-dry-year`);
        expect(dry.startsMinute).toBe(onset * MINUTES_PER_MONTH);
        expect(dry.endsMinute).toBe((onset + 12) * MINUTES_PER_MONTH);
        expect(dry.effects.hydroRunoffMultiplier).toBe(inflow);
        expect(receipt(`:${year}-dry-year:end`).effects).toEqual({});
        const conservation = result.storyOccurrences.find(
          (event) => event.key === `mod:${id}:${year}-year-conservation`,
        );
        if (conserved) {
          expect(conservation).toMatchObject({
            startsMinute: onset * MINUTES_PER_MONTH,
            endsMinute: (onset + 12) * MINUTES_PER_MONTH,
            effects: {
              demandMultiplier: 0.9,
              operatingExpensePerMonth: 125000,
            },
          });
          expect(receipt(`:${year}-year-conservation:end`).effects).toEqual({});
        } else expect(conservation).toBeUndefined();
      }
      expect(grants).toBe(expectedGrants);
      break;
    }
    case "retire-coal-without-bill-shock":
      // A rejected cash purchase is a silent no-op; prove both paid orders exist.
      expect(result.builds).toHaveLength(2);
      expect(result.builds.map((build) => build.month)).toEqual([0, 6]);
      expect(result.finalFacilities.map((facility) => facility.name)).toEqual([
        "Natural Gas CC",
        "Natural Gas CC",
      ]);
      expect(
        result.finalFacilities.every(
          (facility) => facility.yearsToBuildLeft === 0,
        ),
      ).toBe(true);
      expect(grants).toBe(0);
  }
}

function checkConnectionComparison(id: ModExampleId, results: SimResultType[]) {
  if (id !== "funded-or-phased-connection") return;
  const funded = results.find((result) =>
    Object.values(result.options.scenarioResponses).includes("fast-track"),
  )!;
  const phased = results.find((result) =>
    Object.values(result.options.scenarioResponses).includes("phased"),
  )!;
  expect(funded.months[72].demandWh).toBeGreaterThan(
    phased.months[72].demandWh,
  );
}

for (const id of MOD_EXAMPLE_IDS) {
  for (const difficulty of ["Employee", "Manager"] as const) {
    const defaultSeed = readModExample(id).seed ?? 0;
    for (const seed of [defaultSeed, defaultSeed + 1]) {
      test(`${id} reaches every consequential branch on ${difficulty} seed ${seed}`, () => {
        const { scenario } = modExampleScenario(id, difficulty, seed);
        const branches = modExampleBranches(scenario);
        const results: SimResultType[] = [];
        expect(branches).toHaveLength(
          id === "two-dry-years"
            ? 4
            : id === "retire-coal-without-bill-shock"
              ? 1
              : 2,
        );
        for (const scenarioResponses of branches) {
          const result = runSimulation({
            ...modExampleRoute(id),
            scenarioId: 999,
            scenario,
            difficulty,
            seed,
            scenarioResponses,
            scenarioResponseMode: "strict",
          });
          expect(result.violations).toEqual([]);
          expect(result.outcome).toBe("completed");
          expect(result.months).toHaveLength(scenario.durationMonths);
          expect(result.objectiveResults.length).toBeGreaterThan(0);
          expect(
            result.objectiveResults.every(
              (goal) => goal.status === "completed",
            ),
          ).toBe(true);
          for (const choice of ruleChoices(scenario.mod!.rules))
            expect(result.storyOccurrences).toContainEqual(
              expect.objectContaining({
                key: choice.key,
                attributes: expect.objectContaining({
                  choice: scenarioResponses[choice.key],
                }),
              }),
            );
          expect(
            result.finalFacilities.some(
              (facility) => facility.name === result.builds[0]?.name,
            ),
          ).toBe(true);
          checkBranchFacts(id, scenarioResponses, result);
          results.push(result);
        }
        checkConnectionComparison(id, results);
      });
    }
  }
}

test("neglecting expansion in the funded connection example really fails its unchanged reliability goal", () => {
  const id = "funded-or-phased-connection";
  const { pack, scenario } = modExampleScenario(id);
  const decision = ruleChoices(scenario.mod!.rules)[0];
  const result = runSimulation({
    scenarioId: 999,
    scenario,
    difficulty: "Employee",
    seed: pack.seed,
    dollarsPerkWh: 0.12,
    scenarioResponses: { [decision.key]: "fast-track" },
    scenarioResponseMode: "strict",
  });
  expect(result.violations).toEqual([]);
  expect(result.outcome).toBe("fired");
  expect(result.firedAtMonth).toBe(73);
  expect(result.objectiveResults).toContainEqual(
    expect.objectContaining({
      id: "connection-reliability",
      status: "failed",
      target: 0.995,
      observedMonths: 1,
    }),
  );
  expect(
    result.objectiveResults.find(
      (goal) => goal.id === "connection-reliability",
    )!.observed,
  ).toBeLessThan(0.995);
});
