import {
  compileScenarioRules,
  RuleCompilationError,
  validCompiledScenarioRules,
} from "./ScenarioRules";
import { scenarioRuleCompositionDiagnostics } from "./ScenarioRuleComposition";
import { modScenario } from "../mods/ModScenario";
import { validScenarioMod } from "./ScenarioMod";
import { DIFFICULTY_IDS } from "../Constants";
import * as dependencies from "./ScenarioRuleDependencies";
import type { ModPackage } from "../mods/ModSchema";
import type {
  RuleChoice,
  RuleEvent,
  ScenarioRuleDefinitions,
} from "../data/ScenarioRules";

const params = {
  namespace: { kind: "mod" as const, id: "composition" },
  difficulty: "Employee" as const,
  seed: 42,
  startingYear: 2020,
  durationMonths: 120,
  startingPeakW: 1e9,
  startingAssetIds: [],
};
const event = (
  id: string,
  effects: RuleEvent["effects"],
  startMonth: RuleEvent["startMonth"] = 1,
  durationMonths = 2,
): RuleEvent => ({
  id,
  title: id,
  message: "An event starts.",
  preview: "An event will start.",
  startMonth,
  durationMonths,
  effects,
});
const compile = (
  events: RuleEvent[],
  extra: Partial<ScenarioRuleDefinitions> = {},
) => compileScenarioRules({ objectives: [], events, ...extra }, params);

test("a zero carbon override is valid alone and a possible seeded overlap is rejected before ticking", () => {
  const fee = event("free", { carbonFeeDollarsPerTonneCO2e: 0 }, 2, 1);
  expect(compile([fee]).events[0].effects.carbonFeePerKgCO2e).toBe(0);
  expect(() =>
    compile([
      fee,
      event(
        "range",
        { carbonFeeDollarsPerTonneCO2e: 50 },
        { from: 1, to: 3 },
        1,
      ),
    ]),
  ).toThrow(/carbon fees/);
  expect(() =>
    compile([fee, event("later", { carbonFeeDollarsPerTonneCO2e: 50 }, 3, 1)]),
  ).not.toThrow();
});

test("every possible placement is bounded, including a single interior overlap", () => {
  const fixed = event("fixed", { demandMultiplier: 4 }, 2, 1);
  expect(() =>
    compile([
      fixed,
      event("range", { demandMultiplier: 3 }, { from: 1, to: 3 }, 1),
    ]),
  ).toThrow(/compose/);
  expect(() =>
    compile([
      fixed,
      event("range", { demandMultiplier: 2.5 }, { from: 1, to: 3 }, 1),
    ]),
  ).not.toThrow();
});

test("mutually exclusive choice options cannot compose with one another", () => {
  const choices = [
    {
      id: "response",
      dueMonth: 1,
      title: "Response",
      prompt: "Choose a response.",
      options: [
        { id: "a", label: "A", description: "A", message: "A", costDollars: 0 },
        { id: "b", label: "B", description: "B", message: "B", costDollars: 0 },
      ],
    },
  ];
  const events = [
    event("a", { demandMultiplier: 3 }, 2),
    event("b", { demandMultiplier: 4 }, 2),
  ].map((definition) => ({
    ...definition,
    requiresChoice: { choiceId: "response", optionIds: [definition.id] },
  }));
  expect(() => compile(events, { choices })).not.toThrow();
  expect(() =>
    compile(
      events.map((definition) => ({
        ...definition,
        requiresChoice: { choiceId: "response", optionIds: ["a"] },
      })),
      { choices },
    ),
  ).toThrow(/compose/);
});

test("guaranteed simultaneous factors compose together, and meaningful zero inflow remains valid", () => {
  expect(() =>
    compile([
      event("low", { demandMultiplier: 0.1 }),
      event("lower", { demandMultiplier: 0.1 }),
      event("high", { demandMultiplier: 10 }),
    ]),
  ).not.toThrow();
  expect(() =>
    compile([event("dry", { hydroInflowMultiplier: 0 })]),
  ).not.toThrow();
  expect(() =>
    compile([event("dry", { hydroInflowMultiplier: 0.05 })]),
  ).toThrow(/compose/);
  expect(() =>
    compile([
      event("dry", { hydroInflowMultiplier: 0 }),
      event("low", { hydroInflowMultiplier: 0.05 }),
    ]),
  ).toThrow(/compose/);
});

test("timed quotes and running costs include the relevant static facility factor", () => {
  const rules = compile([
    event("construction", {
      constructionCostMultipliersByFuel: { Coal: 2 },
      operatingCostMultipliersByFuel: { Coal: 0.5 },
    }),
  ]);
  expect(
    scenarioRuleCompositionDiagnostics(rules, [
      { fuel: "Coal", buildCost: 5, annualOperatingCost: 0.2 },
    ]),
  ).toEqual([]);
  expect(
    scenarioRuleCompositionDiagnostics(rules, [
      { fuel: "Coal", buildCost: 6, annualOperatingCost: 0.1 },
    ]).map((diagnostic) => diagnostic.code),
  ).toEqual(["composed-static-factor", "composed-static-factor"]);
});

const pack = (baseScenarioId: number): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "detached-arc",
  title: "Detached arc",
  creator: "Creator",
  description: "A detached official arc.",
  version: "1",
  seed: 42,
  baseScenarioId,
  objectives: { mode: "none" },
});

test("all fourteen imported arcs validate as complete detached snapshots in every difficulty", () => {
  for (const id of [
    100, 101, 102, 103, 104, 105, 106, 107, 108, 110, 111, 113, 114, 115,
  ]) {
    for (const difficulty of DIFFICULTY_IDS) {
      const scenario = modScenario(pack(id), undefined, difficulty);
      expect({
        id,
        difficulty,
        valid: validCompiledScenarioRules(scenario.mod!.rules),
      }).toEqual({ id, difficulty, valid: true });
      expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
      const restored = JSON.parse(JSON.stringify(scenario));
      expect(validScenarioMod(restored.mod, restored)).toBe(true);
    }
  }
});

test("composition diagnostics are structured compile failures", () => {
  let failure: unknown;
  try {
    compile([
      event("a", { demandMultiplier: 4 }),
      event("b", { demandMultiplier: 4 }),
    ]);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(RuleCompilationError);
  expect((failure as RuleCompilationError).diagnostics[0].code).toBe(
    "composed-factor",
  );
});

const branch = (
  id: string,
  requiresChoice?: RuleChoice["requiresChoice"],
): RuleChoice => ({
  id,
  dueMonth: 1,
  title: id,
  prompt: "Choose your response.",
  options: ["a", "b"].map((optionId) => ({
    id: optionId,
    label: optionId,
    description: "A response.",
    message: "Response recorded.",
    costDollars: 0,
  })),
  ...(requiresChoice ? { requiresChoice } : {}),
});

test("different descendant choices on opposite branches cannot create a factor or carbon-fee overlap", () => {
  const choices = [
    branch("root"),
    branch("left", { choiceId: "root", optionIds: ["a"] }),
    branch("right", { choiceId: "root", optionIds: ["b"] }),
  ];
  const events = ["left", "right"].map((id) => ({
    ...event(`effect-${id}`, {
      demandMultiplier: 4,
      carbonFeeDollarsPerTonneCO2e: id === "left" ? 0 : 100,
    }),
    requiresChoice: { choiceId: id, optionIds: ["a"] },
  }));
  expect(() => compile(events, { choices })).not.toThrow();
  const possibleTogether = choices.map((choice) =>
    choice.id === "right"
      ? { ...choice, requiresChoice: { choiceId: "root", optionIds: ["a"] } }
      : choice,
  );
  expect(() => compile(events, { choices: possibleTogether })).toThrow(
    /carbon fees|compose/,
  );
});

test("a due blocking choice has an answer on every playable branch", () => {
  const choices = [branch("response")];
  const events = [
    event("first", { demandMultiplier: 4 }),
    event("second", { demandMultiplier: 4 }),
    ...["a", "b"].map((id) => ({
      ...event(`offset-${id}`, { demandMultiplier: 0.5 }),
      requiresChoice: { choiceId: "response", optionIds: [id] },
    })),
  ];
  expect(() => compile(events, { choices })).not.toThrow();
  expect(() =>
    compile(
      events.filter((definition) => definition.id !== "offset-b"),
      {
        choices,
      },
    ),
  ).toThrow(/compose/);
});

test("cross-branch minima preserve low factors without multiplying mutually exclusive paths", () => {
  const choices = [
    branch("root"),
    branch("left", { choiceId: "root", optionIds: ["a"] }),
    branch("right", { choiceId: "root", optionIds: ["b"] }),
  ];
  const events = ["left", "right"].map((id) => ({
    ...event(`effect-${id}`, { demandMultiplier: 0.2 }),
    requiresChoice: { choiceId: id, optionIds: ["a"] },
  }));
  expect(() => compile(events, { choices })).not.toThrow();
  expect(() =>
    compile(events, {
      choices: choices.map((choice) =>
        choice.id === "right"
          ? {
              ...choice,
              requiresChoice: { choiceId: "root", optionIds: ["a"] },
            }
          : choice,
      ),
    }),
  ).toThrow(/compose/);
});

test("the maximum deep multi-option forest is compiled with bounded choice work", () => {
  const optionIds = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const choices = Array.from({ length: 32 }, (_, index) => ({
    ...branch(`decision-${index}`),
    options: optionIds.map((id) => ({
      id,
      label: id,
      description: "A response.",
      message: "Response recorded.",
      costDollars: 0,
    })),
    ...(index
      ? {
          requiresChoice: {
            choiceId: `decision-${index - 1}`,
            optionIds: optionIds.slice(0, 7),
          },
        }
      : {}),
  }));
  const events = Array.from({ length: 100 }, (_, index) => ({
    ...event(`effect-${index}`, { demandMultiplier: 1.001 }, 1, 1200),
    requiresChoice: {
      choiceId: `decision-${index % choices.length}`,
      optionIds: ["a"],
    },
  }));
  const original = dependencies.scenarioRuleChoiceEnvelope;
  let guarded = false;
  let reads = 0;
  const spy = jest
    .spyOn(dependencies, "scenarioRuleChoiceEnvelope")
    .mockImplementation((graph, month, factors) => {
      if (guarded) return original(graph, month, factors);
      guarded = true;
      const restore = graph.nodes.map((node) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          node.choice,
          "options",
        )!;
        const options = node.choice.options;
        Object.defineProperty(node.choice, "options", {
          configurable: true,
          get: () => {
            if (++reads > choices.length * optionIds.length)
              throw new Error(
                "Choice ancestry expanded beyond bounded choice-option work.",
              );
            return options;
          },
        });
        return () => Object.defineProperty(node.choice, "options", descriptor);
      });
      try {
        return original(graph, month, factors);
      } finally {
        restore.forEach((reset) => reset());
      }
    });
  try {
    const compiled = compileScenarioRules(
      { choices, events, objectives: [] },
      { ...params, durationMonths: 1200 },
    );
    expect(compiled.choices).toHaveLength(32);
    expect(compiled.events).toHaveLength(100);
    expect(guarded).toBe(true);
    expect(reads).toBeLessThanOrEqual(choices.length * optionIds.length);
  } finally {
    spy.mockRestore();
  }
});
