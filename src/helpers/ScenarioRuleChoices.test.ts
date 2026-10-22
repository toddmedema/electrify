import {
  compileOfficialArcChoices,
  officialArcChoiceReferences,
  validOfficialArcChoiceMetadata,
} from "./ScenarioRuleChoices";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { SCENARIO_CHOICE_RULES } from "../data/ScenarioChoiceRules";
import { SCENARIOS, DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import type { OfficialArcCompileParameters } from "./ScenarioRuleArcs";
import {
  officialArcLoadScale,
  officialArcMoneyAmount,
} from "./ScenarioRuleArcs";
import type { RuleArc, RuleDiagnostic } from "../data/ScenarioRules";
import type { DifficultyType, ScenarioChoiceType } from "../Types";
import { DIFFICULTY_IDS } from "../Constants";
import reference from "../testing/fixtures/OfficialChoiceReference.json";

const source = (id: number) =>
  SCENARIOS.find((scenario) => scenario.id === id)!;
const parameters = (
  patch: Partial<OfficialArcCompileParameters> = {},
): OfficialArcCompileParameters => ({
  namespace: { kind: "mod", id: "choice-import" },
  difficulty: "Employee",
  seed: 42,
  startingYear: 2050,
  durationMonths: 240,
  startingAssetIds: [],
  receivingScenario: { ...DEFAULT_CUSTOM_SCENARIO, startingYear: 2050 },
  ...patch,
});
const arcs: RuleArc[] = [106, 107, 111].map((scenarioId) => ({
  scenarioId,
  includeChoices: true,
}));
const compile = (
  patch: Partial<OfficialArcCompileParameters> = {},
  imports = arcs,
) => compileOfficialArcChoices(parameters(patch), imports);

test("all official transactions, due dates, outcome messages and phased schedules match the independent pre-conversion reducer capture", () => {
  expect(reference.cases).toHaveLength(30);
  for (const expected of reference.cases) {
    const scenario = source(expected.scenarioId);
    const [choice] = compile(
      {
        namespace: {
          kind: "official",
          scenarioId: scenario.id,
          arcId: "catalog",
        },
        difficulty: expected.difficulty as DifficultyType,
        startingYear: scenario.startingYear,
        durationMonths: scenario.durationMonths,
        receivingScenario: scenario,
      },
      [{ scenarioId: scenario.id, includeChoices: true }],
    );
    const option = choice.options.find(
      (option) => option.id === expected.optionId,
    )!;
    expect(choice.key).toBe(expected.decisionId);
    expect(choice.dueMonth).toBe(expected.dueMonth);
    expect(option.cost).toBe(expected.cost);
    expect(option.grant).toBe(expected.grant);
    expect(option.message).toBe(expected.message);
    const actual = option.replaceLoad?.with.map(
      ({ eventId: _eventId, startMonth: _startMonth, startsMonth, ...load }) =>
        startsMonth === 1 ? load : { ...load, startsMonth },
    );
    expect(actual).toEqual(
      expected.optionId === "phased" ? expected.loadAdditions : undefined,
    );
    expect(option.replaceLoad?.arc).toBe(
      expected.optionId === "phased" ? scenario.id : undefined,
    );
    expect(option.replaceLoad?.loadId).toBe(
      expected.optionId === "phased" ? "manassas-data-centers" : undefined,
    );
  }
});

test("all three choices adapt complete difficulty values into detached data with exact preparation offsets", () => {
  for (const difficulty of DIFFICULTY_IDS) {
    const choices = compile({ difficulty });
    expect(
      choices.map((choice) => [choice.source!.scenarioId, choice.dueMonth]),
    ).toEqual([
      [106, 48],
      [107, 36],
      [111, 35],
    ]);
    expect(choices.map((choice) => choice.key)).toEqual([
      "mod:choice-import:arc:106:choice:connection",
      "mod:choice-import:arc:107:choice:winterization",
      "mod:choice-import:arc:111:choice:preparedness",
    ]);
    expect(JSON.parse(JSON.stringify(choices))).toEqual(choices);
    expect(choices.every(validOfficialArcChoiceMetadata)).toBe(true);
    expect(
      choices.every((choice) =>
        choice.options.some(
          (option) => option.id === choice.freeOptionId && option.cost === 0,
        ),
      ),
    ).toBe(true);
    expect(
      choices
        .flatMap((choice) => choice.options)
        .every((option) => !/\{(?:cost|grant)\}/.test(option.description)),
    ).toBe(true);
  }
});

test("connection budgets and both permanent loads scale with the receiving grid and era, and labels describe the actual relocated schedules", () => {
  const original = source(106);
  const receiving = {
    ...original,
    id: 999,
    startingYear: 2040,
    startingCustomers: original.startingCustomers! * 2,
  };
  const [choice] = compile(
    { receivingScenario: receiving, startingYear: 2040 },
    [arcs[0]],
  );
  const funded = choice.options.find((option) => option.id === "fast-track")!;
  const phased = choice.options.find((option) => option.id === "phased")!;
  expect(funded.grant).toBe(
    officialArcMoneyAmount(15000000, original, receiving),
  );
  expect(funded.grant).toBe(49000000);
  expect(funded.description).toMatch(/200MW.*January 2046/);
  expect(funded.message).toMatch(/200MW.*January 2046/);
  expect(phased.replaceLoad).toMatchObject({
    arc: 106,
    loadId: "manassas-data-centers",
  });
  expect(
    phased.replaceLoad!.with.map((load) => [
      load.id,
      load.startMonth,
      load.startsYear,
      load.peakW,
    ]),
  ).toEqual([
    ["manassas-data-centers-phase-one", 72, 2046, 100000000],
    ["manassas-data-centers-phase-two", 96, 2048, 100000000],
  ]);
  expect(phased.description).toMatch(
    /100MW in January 2046 and 100MW in January 2048/,
  );
  expect(officialArcLoadScale(original, receiving)).toBe(2);
});

test("freeze and wildfire protection prices scale once, preserving the exact free and consequential responses", () => {
  for (const id of [107, 111]) {
    const original = source(id);
    const receiving = {
      ...original,
      id: 999,
      startingYear: original.startingYear + 10,
      startingCustomers: original.startingCustomers! * 3,
    };
    const [choice] = compile(
      { receivingScenario: receiving, startingYear: receiving.startingYear },
      [{ scenarioId: id, includeChoices: true }],
    );
    const paid = choice.options.find((option) => option.cost > 0)!;
    expect(paid.cost).toBe(
      officialArcMoneyAmount(
        id === 107 ? 90000000 : 2000000,
        original,
        receiving,
      ),
    );
    expect(choice.freeOptionId).toBe("standard");
    expect(
      choice.options.find((option) => option.id === "standard"),
    ).toMatchObject({ cost: 0, grant: 0, meaningful: false });
    expect(paid.message).toContain(
      id === 107 ? "February 2031" : "January–February",
    );
    expect(paid.message).not.toContain("2021");
  }
});

test("includeChoices false compiles an automatic free response without dropping the choice or its consequences", () => {
  const choices = compile(
    {},
    arcs.map((arc) => ({ ...arc, includeChoices: false })),
  );
  expect(
    choices.map((choice) => [choice.automatic, choice.freeOptionId]),
  ).toEqual([
    [true, "fast-track"],
    [true, "standard"],
    [true, "standard"],
  ]);
  expect(
    choices[0].options.find((option) => option.id === choices[0].freeOptionId)!
      .grant,
  ).toBeGreaterThan(0);
  expect(compile().every((choice) => choice.automatic === undefined)).toBe(
    true,
  );
});

test("all relocated choices and every possible replacement load are diagnosed outside the term", () => {
  const diagnostics: RuleDiagnostic[] = [];
  compile({ durationMonths: 30, diagnostics });
  expect(
    diagnostics.filter((diagnostic) => diagnostic.code === "outside-term"),
  ).toHaveLength(5);
  expect(
    diagnostics.every(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.path.includes("officialArcs"),
    ),
  ).toBe(true);
  expect(() => compile({ durationMonths: 96 }, [arcs[0]])).toThrow(/month 97/);
  expect(() => compile({ durationMonths: 97 }, [arcs[0]])).not.toThrow();
});

test("scaled imported costs and loads pass through the owning numeric bounds before launch", () => {
  const original = source(106);
  const receiving = {
    ...original,
    id: 999,
    startingYear: 2100,
    startingCustomers: 100000000,
    startingDemandScale: 100,
  };
  const diagnostics: RuleDiagnostic[] = [];
  compile({ receivingScenario: receiving, startingYear: 2100, diagnostics }, [
    arcs[0],
  ]);
  expect(
    diagnostics.some(
      (diagnostic) =>
        diagnostic.path.endsWith(".peakMW") && diagnostic.severity === "error",
    ),
  ).toBe(true);
  expect(() =>
    compile({ receivingScenario: receiving, startingYear: 2100 }, [arcs[0]]),
  ).toThrow(/peakMW/);
  expect(() =>
    compile(
      {
        receivingScenario: {
          ...original,
          id: 999,
          startingCustomers: original.startingCustomers! * 2,
        },
        startingYear: original.startingYear,
      },
      [arcs[0]],
    ),
  ).not.toThrow();
});

test("an unknown legacy choice cannot be silently imported without an explicit data adaptation", () => {
  const injected: ScenarioChoiceType = {
    id: "story:106:data-center-boom:unconverted",
    scenarioId: 106,
    atMonth: 1,
    title: "New source choice",
    message: "Choose",
    options: [{ id: "free", label: "Free", message: "Free", cost: () => 0 }],
  };
  SCENARIO_CHOICES.push(injected);
  try {
    expect(() => compile({}, [arcs[0]])).toThrow(/no declarative adaptation/);
  } finally {
    SCENARIO_CHOICES.pop();
  }
  expect(() => compile({}, [arcs[0]])).not.toThrow();
});

test("saved choice metadata validates with source callbacks disabled and rejects forged operations", () => {
  const choices = compile();
  const callbacks = SCENARIO_CHOICES.flatMap((choice) =>
    choice.options.map((option) => ({
      option,
      cost: option.cost,
      upfrontGrant: option.upfrontGrant,
    })),
  );
  try {
    callbacks.forEach(({ option }) => {
      option.cost = () => {
        throw new Error("Legacy callbacks removed");
      };
      option.upfrontGrant = () => {
        throw new Error("Legacy callbacks removed");
      };
    });
    expect(compile()).toEqual(choices);
    expect(
      JSON.parse(JSON.stringify(choices)).every(validOfficialArcChoiceMetadata),
    ).toBe(true);
  } finally {
    callbacks.forEach(({ option, cost, upfrontGrant }) => {
      option.cost = cost;
      option.upfrontGrant = upfrontGrant;
    });
  }
  const choice = choices[0];
  expect(
    validOfficialArcChoiceMetadata({
      ...choice,
      source: { ...choice.source, callback: "execute" },
    }),
  ).toBe(false);
  expect(
    validOfficialArcChoiceMetadata({
      ...choice,
      source: { ...choice.source, scenarioId: 999 },
    }),
  ).toBe(false);
  expect(validOfficialArcChoiceMetadata({ ...choice, automatic: false })).toBe(
    false,
  );
  expect(
    validOfficialArcChoiceMetadata({
      ...choice,
      options: [{ ...choice.options[0], meaningful: true }],
    }),
  ).toBe(false);
  expect(
    validOfficialArcChoiceMetadata({
      ...choice,
      source: { ...choice.source, choiceId: "bad:key" },
    }),
  ).toBe(false);
});

test("canonical source order never changes free selection, references or compiled identity", () => {
  const expected = compile();
  const refs = officialArcChoiceReferences();
  SCENARIO_CHOICE_RULES.reverse();
  SCENARIO_CHOICE_RULES.forEach((entry) => entry.choice.options.reverse());
  try {
    expect(compile({}, [...arcs].reverse())).toEqual(expected);
    expect(officialArcChoiceReferences()).toEqual(refs);
    expect(refs.find((entry) => entry.scenarioId === 106)).toMatchObject({
      choiceId: "connection",
      optionIds: ["fast-track", "phased"],
      loadIds: [
        "manassas-data-centers",
        "manassas-data-centers-phase-one",
        "manassas-data-centers-phase-two",
      ],
    });
  } finally {
    SCENARIO_CHOICE_RULES.reverse();
    SCENARIO_CHOICE_RULES.forEach((entry) => entry.choice.options.reverse());
  }
});

test("detached saved choice metadata remains valid when the current catalog is removed", () => {
  const choices = compile();
  const saved = JSON.stringify(choices);
  const original = SCENARIO_CHOICE_RULES.splice(0);
  try {
    expect(JSON.parse(saved).every(validOfficialArcChoiceMetadata)).toBe(true);
    expect(JSON.stringify(choices)).toBe(saved);
  } finally {
    SCENARIO_CHOICE_RULES.push(...original);
  }
});

test("arcs without a choice remain valid and official provenance cannot import another scenario's decision", () => {
  expect(compile({}, [{ scenarioId: 100, includeChoices: true }])).toEqual([]);
  expect(() =>
    compile(
      { namespace: { kind: "official", scenarioId: 100, arcId: "catalog" } },
      [arcs[0]],
    ),
  ).toThrow(/trusted source/);
  expect(() =>
    compile({}, [{ scenarioId: 1234, includeChoices: true }]),
  ).toThrow(/no importable/);
});
