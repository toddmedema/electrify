import type {
  CompiledRuleChoice,
  CompiledRuleEvent,
  CompiledScenarioRules,
  RuleCondition,
} from "../data/ScenarioRules";
import {
  createScenarioRuleChoiceGraph,
  resolveScenarioRuleChoice,
  ruleChoices,
  scenarioRuleChoiceEnvelope,
  scenarioRuleConditionsCanCoexist,
  scenarioRuleDependencyDiagnostics,
} from "./ScenarioRuleDependencies";

const choice = (
  id: string,
  patch: Partial<CompiledRuleChoice> = {},
): CompiledRuleChoice => ({
  id,
  key: `mod:dependency-test:${id}`,
  dueMonth: 0,
  title: id,
  prompt: "Choose a response.",
  options: ["a", "b", "c"].map((id) => ({
    id,
    label: id,
    description: "A response.",
    message: "Response recorded.",
    cost: 0,
    grant: 0,
  })),
  freeOptionId: "a",
  ...patch,
});
const event = (
  id: string,
  condition?: RuleCondition,
  patch: Partial<CompiledRuleEvent> = {},
): CompiledRuleEvent => ({
  id,
  key: `mod:dependency-test:${id}`,
  title: id,
  message: "An event starts.",
  preview: "An event will start.",
  visibility: "forecast",
  startMonth: 0,
  possibleStartMonths: { from: 0, to: 0 },
  durationMonths: 1,
  effects: {},
  targets: [],
  transactions: [],
  ...(condition ? { requiresChoice: condition } : {}),
  ...patch,
});
const rules = (
  choices: CompiledRuleChoice[] = [],
  patch: Partial<CompiledScenarioRules> = {},
): CompiledScenarioRules => ({
  runtimeVersion: 1,
  namespace: { kind: "mod", id: "dependency-test" },
  difficulty: "Employee",
  seed: 1,
  startingYear: 2020,
  durationMonths: 1200,
  startingPeakW: 1e9,
  startingAssetIds: [],
  officialArcs: [],
  choices,
  events: [],
  objectives: [],
  loads: [],
  debriefReports: [],
  ...patch,
});
const requires = (choiceId: string, ...optionIds: string[]): RuleCondition => ({
  choiceId,
  optionIds,
});
const hasCode = (input: CompiledScenarioRules, code: string) =>
  scenarioRuleDependencyDiagnostics(input).some(
    (diagnostic) => diagnostic.code === code,
  );

test("own and imported references stay distinct and ordering ignores input arrays", () => {
  const own = choice("winterization");
  const imported = choice("arc-107-winterization", {
    source: {
      scenarioId: 107,
      arcId: "deep-freeze",
      choiceId: "winterization",
    },
    key: "mod:dependency-test:arc:107:choice:winterization",
  });
  const input = rules([own], { arcChoices: [imported] });
  expect(resolveScenarioRuleChoice({ choiceId: "winterization" }, input)).toBe(
    own,
  );
  expect(
    resolveScenarioRuleChoice({ arc: 107, choiceId: "winterization" }, input),
  ).toBe(imported);
  expect(
    resolveScenarioRuleChoice({ arc: 106, choiceId: "winterization" }, input),
  ).toBeUndefined();
  expect(ruleChoices(input).map((item) => item.id)).toEqual([
    "arc-107-winterization",
    "winterization",
  ]);
  expect(
    ruleChoices(rules([choice("z"), own, choice("a")])).map((item) => item.id),
  ).toEqual(["a", "winterization", "z"]);
});

test("conditions intersect option sets and all ancestors without enumerating response combinations", () => {
  const input = rules([
    choice("root"),
    choice("left", { requiresChoice: requires("root", "a") }),
    choice("right", { requiresChoice: requires("root", "b", "c") }),
    choice("deep", { requiresChoice: requires("left", "a", "b") }),
  ]);
  const graph = createScenarioRuleChoiceGraph(input);
  expect(graph.diagnostics).toEqual([]);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [
      requires("root", "a", "b"),
      requires("root", "b", "c"),
    ]),
  ).toBe(true);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [
      requires("root", "a"),
      requires("root", "b", "c"),
    ]),
  ).toBe(false);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [
      requires("deep", "c"),
      requires("left", "b"),
    ]),
  ).toBe(true);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [
      requires("deep", "c"),
      requires("left", "c"),
    ]),
  ).toBe(false);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [
      requires("deep", "a"),
      requires("right", "a"),
    ]),
  ).toBe(false);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [requires("missing", "a")]),
  ).toBe(false);
});

test("an automatic free response excludes paid descendants without making valid branches an error", () => {
  const input = rules([
    choice("root", { automatic: true }),
    choice("reachable", { requiresChoice: requires("root", "a") }),
    choice("unreachable", { requiresChoice: requires("root", "b") }),
    choice("also-unreachable", {
      requiresChoice: requires("unreachable", "a"),
    }),
  ]);
  const diagnostics = scenarioRuleDependencyDiagnostics(input);
  expect(
    diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  ).toEqual([]);
  expect(
    diagnostics
      .filter((diagnostic) => diagnostic.code === "unreachable-choice")
      .map((diagnostic) => diagnostic.path)
      .sort(),
  ).toEqual(["choices[2]", "choices[3]"]);
  const graph = createScenarioRuleChoiceGraph(input);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [requires("reachable", "b")]),
  ).toBe(true);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [requires("unreachable", "a")]),
  ).toBe(false);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [
      requires("also-unreachable", "a"),
    ]),
  ).toBe(false);
});

test("a future choice has no answer before its due month and every option is considered when due", () => {
  const input = rules([choice("later", { dueMonth: 10 })]);
  const graph = createScenarioRuleChoiceGraph(input);
  const factors = [
    { min: 16, max: 16, positiveMin: 16 },
    ...["a", "b", "c"].map((id) => ({
      requiresChoice: requires("later", id),
      min: 0.5,
      max: 0.5,
      positiveMin: 0.5,
    })),
  ];
  expect(
    scenarioRuleConditionsCanCoexist(graph, [requires("later", "a")], 9),
  ).toBe(false);
  expect(
    scenarioRuleConditionsCanCoexist(graph, [requires("later", "a")], 10),
  ).toBe(true);
  expect(scenarioRuleChoiceEnvelope(graph, 9, factors)).toEqual({
    min: 16,
    max: 16,
    positiveMin: 16,
  });
  expect(scenarioRuleChoiceEnvelope(graph, 10, factors)).toEqual({
    min: 8,
    max: 8,
    positiveMin: 8,
  });
});

test.each([
  ["empty-options", requires("root")],
  ["duplicate-option-reference", requires("root", "a", "a")],
  ["unknown-option", requires("root", "unknown")],
  ["unnecessary-condition", requires("root", "a", "b", "c")],
  ["unknown-choice", requires("missing", "a")],
] as const)(
  "rejects %s with an exact condition path and accepts its valid neighbor",
  (code, condition) => {
    const input = rules([
      choice("root"),
      choice("child", { requiresChoice: condition }),
    ]);
    const diagnostic = scenarioRuleDependencyDiagnostics(input).find(
      (item) => item.code === code,
    );
    expect(diagnostic?.path).toMatch(/^choices\[1\]\.requiresChoice/);
    expect(diagnostic?.severity).toBe("error");
    expect(
      scenarioRuleDependencyDiagnostics(
        rules([
          choice("root"),
          choice("child", { requiresChoice: requires("root", "a") }),
        ]),
      ),
    ).toEqual([]);
  },
);

test("all seeded placements must follow the decision, not only the selected draw", () => {
  const target = choice("response", { dueMonth: 3 });
  const input = rules([target], {
    events: [
      event("change", requires("response", "a"), {
        startMonth: 5,
        possibleStartMonths: { from: 2, to: 6 },
      }),
    ],
  });
  expect(scenarioRuleDependencyDiagnostics(input)).toContainEqual(
    expect.objectContaining({
      code: "later-decision",
      path: "events[0].requiresChoice",
      severity: "error",
    }),
  );
  expect(
    scenarioRuleDependencyDiagnostics(
      rules([target], {
        events: [
          event("change", requires("response", "a"), {
            startMonth: 5,
            possibleStartMonths: { from: 3, to: 6 },
          }),
        ],
      }),
    ),
  ).toEqual([]);
});

test("a choice cannot depend on a later decision, including an imported one", () => {
  const imported = choice("arc-107-winterization", {
    dueMonth: 12,
    source: { scenarioId: 107, arcId: "freeze", choiceId: "winterization" },
  });
  const child = choice("response", {
    dueMonth: 11,
    requiresChoice: { arc: 107, choiceId: "winterization", optionIds: ["a"] },
  });
  expect(
    hasCode(rules([child], { arcChoices: [imported] }), "later-decision"),
  ).toBe(true);
  expect(
    hasCode(
      rules([{ ...child, dueMonth: 12 }], { arcChoices: [imported] }),
      "later-decision",
    ),
  ).toBe(false);
});

test("cross-namespace cycles are rejected before graph traversal can affect simulation", () => {
  const own = choice("response", {
    requiresChoice: { arc: 107, choiceId: "winterization", optionIds: ["a"] },
  });
  const imported = choice("arc-107-winterization", {
    source: { scenarioId: 107, arcId: "freeze", choiceId: "winterization" },
    requiresChoice: requires("response", "a"),
  });
  const input = rules([own], { arcChoices: [imported] });
  expect(hasCode(input, "choice-cycle")).toBe(true);
  expect(
    scenarioRuleConditionsCanCoexist(createScenarioRuleChoiceGraph(input), [
      requires("response", "a"),
    ]),
  ).toBe(false);
  expect(
    hasCode(
      rules([{ ...own, requiresChoice: undefined }], {
        arcChoices: [imported],
      }),
      "choice-cycle",
    ),
  ).toBe(false);
});

test("missing imported references are deferred only for intermediate compilation", () => {
  const input = rules(
    [
      choice("dependent", {
        requiresChoice: {
          arc: 107,
          choiceId: "winterization",
          optionIds: ["a"],
        },
      }),
    ],
    {
      events: [
        event("effect", {
          arc: 107,
          choiceId: "winterization",
          optionIds: ["a"],
        }),
      ],
    },
  );
  expect(
    scenarioRuleDependencyDiagnostics(input).filter(
      (diagnostic) => diagnostic.code === "unknown-choice",
    ),
  ).toHaveLength(2);
  expect(
    scenarioRuleDependencyDiagnostics(input, {
      allowUnresolvedArcChoices: true,
    }),
  ).toEqual([]);
  const ownMissing = rules([
    choice("dependent", { requiresChoice: requires("absent", "a") }),
  ]);
  expect(
    scenarioRuleDependencyDiagnostics(ownMissing, {
      allowUnresolvedArcChoices: true,
    }).some((diagnostic) => diagnostic.code === "unknown-choice"),
  ).toBe(true);
});

test("duplicate reference identities and a forged free option are rejected", () => {
  expect(
    hasCode(
      rules([choice("same"), choice("same")]),
      "duplicate-choice-reference",
    ),
  ).toBe(true);
  expect(
    hasCode(
      rules([choice("valid", { freeOptionId: "not-an-option" })]),
      "invalid-free-option",
    ),
  ).toBe(true);
  expect(scenarioRuleDependencyDiagnostics(rules([choice("valid")]))).toEqual(
    [],
  );
});

test("replacement loads cannot be backdated before the decision", () => {
  const inputChoice = choice("response", { dueMonth: 2 });
  inputChoice.options[0].replaceLoad = {
    loadId: "campus",
    with: [
      {
        id: "replacement",
        eventId: "response",
        startMonth: 1,
        startsYear: 2020,
        startsMonth: 2,
        label: "Data Centers",
        demandType: "Data Centers",
        loadFactor: 0.8,
        peakW: 1e8,
      },
    ],
  };
  expect(hasCode(rules([inputChoice]), "replacement-before-decision")).toBe(
    true,
  );
  inputChoice.options[0].replaceLoad.with[0].startMonth = 2;
  expect(hasCode(rules([inputChoice]), "replacement-before-decision")).toBe(
    false,
  );
});

test("unreachable event diagnostics stay warnings and point to their condition", () => {
  const input = rules([choice("response", { automatic: true })], {
    events: [event("unused", requires("response", "b"))],
  });
  expect(scenarioRuleDependencyDiagnostics(input)).toEqual([
    expect.objectContaining({
      code: "unreachable-event",
      path: "events[0].requiresChoice",
      severity: "warning",
    }),
  ]);
});

test("all choice months must be inside the term", () => {
  expect(
    hasCode(rules([choice("late", { dueMonth: 1200 })]), "outside-term"),
  ).toBe(true);
  expect(
    hasCode(rules([choice("early", { dueMonth: -1 })]), "outside-term"),
  ).toBe(true);
  expect(
    scenarioRuleDependencyDiagnostics(
      rules([choice("final", { dueMonth: 1199 })]),
    ),
  ).toEqual([]);
});

const replaces = (id: string, target = "campus", arc?: number) => {
  const result = choice(id);
  result.options[0].replaceLoad = {
    loadId: target,
    with: [],
    ...(arc === undefined ? {} : { arc }),
  };
  return result;
};

test("independent choices cannot both replace the same load", () => {
  const input = rules([replaces("first"), replaces("second")]);
  expect(scenarioRuleDependencyDiagnostics(input)).toContainEqual(
    expect.objectContaining({
      code: "overlapping-load-replacement",
      severity: "error",
      path: "choices[1].options[0].replaceLoad",
    }),
  );
  expect(
    hasCode(
      rules([replaces("first"), replaces("second", "another-campus")]),
      "overlapping-load-replacement",
    ),
  ).toBe(false);
});

test("mutually exclusive branches and options can replace the same load", () => {
  const left = { ...replaces("left"), requiresChoice: requires("root", "a") };
  const right = { ...replaces("right"), requiresChoice: requires("root", "b") };
  const input = rules([choice("root"), left, right]);
  expect(scenarioRuleDependencyDiagnostics(input)).toEqual([]);
  const sameChoice = replaces("response");
  sameChoice.options[1].replaceLoad = { loadId: "campus", with: [] };
  expect(scenarioRuleDependencyDiagnostics(rules([sameChoice]))).toEqual([]);
  expect(
    hasCode(
      rules([
        choice("root"),
        left,
        { ...right, requiresChoice: requires("root", "a") },
      ]),
      "overlapping-load-replacement",
    ),
  ).toBe(true);
});

test("an authored reference cannot collide with a different arc load namespace", () => {
  expect(
    scenarioRuleDependencyDiagnostics(
      rules([replaces("own"), replaces("imported", "campus", 106)]),
    ),
  ).toEqual([]);
  expect(
    hasCode(
      rules([
        replaces("first", "campus", 106),
        replaces("second", "campus", 106),
      ]),
      "overlapping-load-replacement",
    ),
  ).toBe(true);
});

test("an imported automatic answer participates in replacement collision checks", () => {
  const imported = {
    ...replaces("arc-106-connection", "campus", 106),
    automatic: true,
    source: {
      scenarioId: 106,
      arcId: "data-center-boom",
      choiceId: "connection",
    },
  };
  const authored = replaces("connection", "campus", 106);
  expect(
    hasCode(
      rules([authored], { arcChoices: [imported] }),
      "overlapping-load-replacement",
    ),
  ).toBe(true);
  imported.options[0].replaceLoad = undefined;
  imported.options[1].replaceLoad = { arc: 106, loadId: "campus", with: [] };
  expect(
    hasCode(
      rules([authored], { arcChoices: [imported] }),
      "overlapping-load-replacement",
    ),
  ).toBe(false);
});

test("independent choice trees combine their feasible envelopes", () => {
  const graph = createScenarioRuleChoiceGraph(
    rules([choice("first"), choice("second")]),
  );
  const envelope = scenarioRuleChoiceEnvelope(graph, 0, [
    { requiresChoice: requires("first", "a"), min: 2, max: 2, positiveMin: 2 },
    {
      requiresChoice: requires("first", "b"),
      min: 0.5,
      max: 0.5,
      positiveMin: 0.5,
    },
    { requiresChoice: requires("second", "a"), min: 3, max: 3, positiveMin: 3 },
    {
      requiresChoice: requires("second", "b"),
      min: 0.2,
      max: 0.2,
      positiveMin: 0.2,
    },
  ]);
  expect(envelope).toEqual({ min: 0.1, max: 6, positiveMin: 0.1 });
});
