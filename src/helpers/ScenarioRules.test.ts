import {
  compileScenarioRules,
  RuleCompilationError,
  scenarioRules,
  validCompiledScenarioRules,
} from "./ScenarioRules";
import {
  modRuntimeDigest,
  modSetupDigest,
  validScenarioMod,
} from "./ScenarioMod";
import { modScenario, inheritedModObjectives } from "../mods/ModScenario";
import { packageDigest, type ModPackage } from "../mods/ModSchema";
import { modPackage } from "../testing/ModFixtures";
import { SCENARIOS, DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { DIFFICULTY_IDS } from "../Constants";
import { matchScenario } from "../multiplayer/World";
import { validBrowseState } from "../multiplayer/Browse";
import { launchCustomScenario, tickState } from "../reducers/Game";
import { prepareCustomScenario } from "./CustomScenarioEvents";
import { createGame } from "../testing/Simulator";
import { parseSave } from "../SaveGame";
import type { RuleEvent, ScenarioRuleDefinitions } from "../data/ScenarioRules";
import type { ScenarioModType } from "../Types";
import { roundTrip } from "../testing/SaveForgery";
const params = {
  namespace: { kind: "mod" as const, id: "test-grid" },
  difficulty: "Employee" as const,
  seed: 42,
  startingYear: 2020,
  durationMonths: 36,
  startingPeakW: 500e6,
  startingAssetIds: ["original-reactor"],
};
const pack = (): ModPackage =>
  modPackage({
    id: "test-grid",
    title: "Test Grid",
    creator: "Creator",
    description: "Grid metadata: plan a reliable grid.",
  });
const event = (id = "dry-year"): RuleEvent => ({
  id,
  title: "Dry year",
  message: "Inflow is lower.",
  preview: "Inflow will fall.",
  startMonth: 13,
  durationMonths: 12,
  effects: {
    hydroInflowMultiplier: 0,
    transactions: [{ kind: "grant", amountDollars: 1000 }],
    carbonFeeDollarsPerTonneCO2e: 50,
  },
});
const rules = (events: RuleEvent[] = [event()]): ScenarioRuleDefinitions => ({
  events,
  objectives: [
    {
      id: "affordability",
      label: "Keep bills affordable",
      metric: "monthlyBilledRate",
      fromMonth: 13,
      throughMonth: 24,
      maxDollarsPerKWh: 0.99,
    },
  ],
  debriefReports: [
    { id: "review", kind: "reliability", fromMonth: 13, throughMonth: 24 },
  ],
});

test("ordinary custom compilation caches actual run parameters without serializing changing game state", () => {
  const scenario = prepareCustomScenario({
    ...DEFAULT_CUSTOM_SCENARIO,
    eventScenarioIds: [103, 110],
  });
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 42,
    difficulty: "Employee",
  });
  const original = scenarioRules(scenario, game)!;
  expect(original.seed).toBe(42);
  expect(original.difficulty).toBe(game.difficulty);
  tickState(game);
  expect(scenarioRules(scenario, game)).toBe(original);
  const changedSeed = scenarioRules(scenario, { ...game, seed: 43 })!;
  expect(changedSeed).not.toBe(original);
  expect(changedSeed.seed).toBe(43);
  const changedDifficulty = scenarioRules(scenario, {
    ...game,
    difficulty: "CEO",
  })!;
  expect(changedDifficulty).not.toBe(original);
  expect(changedDifficulty.difficulty).toBe("CEO");
  expect(scenarioRules(scenario, game)).toBe(original);
});

test("compiles author months and human units once, preserving meaningful zeros", () => {
  const definitions = rules();
  definitions.events![0].loads = [
    {
      id: "campus",
      startMonth: 13,
      demandType: "Data Centers",
      loadFactor: 0.9,
      peakShareOfStartingPeak: 0.2,
    },
  ];
  const compiled = compileScenarioRules(definitions, params);
  expect(compiled.events[0]).toMatchObject({
    startMonth: 12,
    durationMonths: 12,
    effects: { hydroRunoffMultiplier: 0, carbonFeePerKgCO2e: 0.05 },
    transactions: [{ kind: "grant", amount: 1000 }],
  });
  expect(compiled.loads[0]).toMatchObject({
    startMonth: 12,
    startsYear: 2021,
    startsMonth: 1,
    peakW: 100e6,
  });
  expect(compiled.objectives[0]).toMatchObject({
    fromMonth: 12,
    throughMonth: 23,
    required: true,
  });
  expect(compiled.debriefReports[0]).toMatchObject({
    fromMonth: 12,
    throughMonth: 23,
  });
  expect(validCompiledScenarioRules(compiled)).toBe(true);
  definitions.events![0].message = "Changed in the package.";
  expect(compiled.events[0].message).toBe("Inflow is lower.");
});

test("difficulty values freeze into a detached runtime at each difficulty", () => {
  const values = { Intern: 0, Employee: 0.1, Manager: 0.25, VP: 0.5, CEO: 1 };
  for (const difficulty of DIFFICULTY_IDS) {
    const definitions = rules();
    definitions.events![0].effects!.hydroInflowMultiplier = {
      byDifficulty: values,
    };
    const compiled = compileScenarioRules(definitions, {
      ...params,
      difficulty,
    });
    expect(compiled.events[0].effects.hydroRunoffMultiplier).toBe(
      values[difficulty],
    );
    expect(JSON.stringify(compiled)).not.toContain("byDifficulty");
    expect(validCompiledScenarioRules(compiled)).toBe(true);
  }
});

test("seeded placement and completed identities survive reordering and unrelated content", () => {
  const first = {
    ...event("a-drought"),
    startMonth: { from: 3, to: 15 },
    durationMonths: "untilEnd" as const,
  };
  const second = {
    id: "b-news",
    title: "Review",
    message: "Review your grid.",
    startMonth: 2,
  };
  const a = compileScenarioRules(rules([first, second]), params);
  const b = compileScenarioRules(rules([second, first]), params);
  expect(a).toEqual(b);
  const c = compileScenarioRules(
    rules([{ ...second, id: "new-news" }, first, second]),
    params,
  );
  expect(c.events.find((e) => e.id === first.id)).toEqual(
    a.events.find((e) => e.id === first.id),
  );
  const drought = a.events.find((e) => e.id === first.id)!;
  expect(drought.startMonth + drought.durationMonths).toBe(36);
  expect(drought.durationUntilEnd).toBe(true);
  expect(validCompiledScenarioRules(a)).toBe(true);
});

test("reports, objects and choices share one namespace with scoped option IDs", () => {
  const definitions = rules();
  definitions.choices = [
    {
      id: "affordability",
      title: "Choose",
      prompt: "Choose your plan.",
      dueMonth: 1,
      options: [
        {
          id: "free",
          label: "Free",
          description: "Keep cash.",
          message: "Cash kept.",
          costDollars: 0,
        },
        {
          id: "paid",
          label: "Paid",
          description: "Pay.",
          message: "Paid.",
          costDollars: 1,
        },
      ],
    },
  ];
  expect(() => compileScenarioRules(definitions, params)).toThrow(
    /repeats affordability/,
  );
  definitions.choices[0].id = "plan";
  expect(() => compileScenarioRules(definitions, params)).not.toThrow();
});

test("dependencies and replacements reject unknown, cyclic, late and started references", () => {
  const options = [
    {
      id: "free",
      label: "Free",
      description: "Keep cash.",
      message: "Cash kept.",
      costDollars: 0,
    },
    {
      id: "paid",
      label: "Paid",
      description: "Pay.",
      message: "Paid.",
      costDollars: 1,
    },
  ];
  const definitions: ScenarioRuleDefinitions = {
    objectives: [],
    choices: [
      {
        id: "first",
        title: "First",
        prompt: "Choose.",
        dueMonth: 2,
        requiresChoice: { choiceId: "second", optionIds: ["paid"] },
        options,
      },
      {
        id: "second",
        title: "Second",
        prompt: "Choose.",
        dueMonth: 2,
        requiresChoice: { choiceId: "first", optionIds: ["paid"] },
        options,
      },
    ],
  };
  expect(() => compileScenarioRules(definitions, params)).toThrow(/cycle/);
  delete definitions.choices![0].requiresChoice;
  delete definitions.choices![1].requiresChoice;
  definitions.events = [
    {
      ...event(),
      startMonth: { from: 1, to: 3 },
      requiresChoice: { choiceId: "first", optionIds: ["paid"] },
    },
  ];
  expect(() => compileScenarioRules(definitions, params)).toThrow(
    /dependency is due in month 2/,
  );
  definitions.events[0].startMonth = 2;
  definitions.events[0].requiresChoice!.optionIds = ["forged"];
  expect(() => compileScenarioRules(definitions, params)).toThrow(
    /not an option/,
  );
  definitions.events[0].requiresChoice!.optionIds = ["free", "paid"];
  expect(() => compileScenarioRules(definitions, params)).toThrow(
    /every option/,
  );
  delete definitions.events[0].requiresChoice;
  definitions.events[0].loads = [
    {
      id: "campus",
      startMonth: 2,
      demandType: "Data Centers",
      peakMW: 100,
      loadFactor: 0.9,
    },
  ];
  definitions.choices![0].options = [
    { ...options[0], replaceLoad: { loadId: "campus", with: [] } },
    options[1],
  ];
  expect(() => compileScenarioRules(definitions, params)).toThrow(
    /only before its start month/,
  );
  definitions.events[0].loads[0].startMonth = 3;
  expect(
    validCompiledScenarioRules(compileScenarioRules(definitions, params)),
  ).toBe(true);
});

test("unknown starting assets cannot silently retarget a selector", () => {
  const definitions = rules();
  definitions.events![0].effects!.outputMultipliersBySelector = [
    {
      target: { selector: "startingAsset", assetId: "replacement-reactor" },
      outputMultiplier: 0,
    },
  ];
  expect(() => compileScenarioRules(definitions, params)).toThrow(
    /not supplied by this base/,
  );
  definitions.events![0].effects!.outputMultipliersBySelector[0].target = {
    selector: "startingAsset",
    assetId: "original-reactor",
  };
  expect(
    validCompiledScenarioRules(compileScenarioRules(definitions, params)),
  ).toBe(true);
});

test("every bundled asset has a stable catalog ID and initialization persists its binding", () => {
  for (const base of [...SCENARIOS, DEFAULT_CUSTOM_SCENARIO]) {
    expect(base.facilities.every((f) => f.assetId)).toBe(true);
    expect(new Set(base.facilities.map((f) => f.assetId)).size).toBe(
      base.facilities.length,
    );
  }
  const scenario = modScenario(
    { ...pack(), baseScenarioId: 110 },
    undefined,
    "Manager",
  );
  const game = createGame({
    scenarioId: 999,
    scenario,
    difficulty: "Manager",
    seed: 42,
  });
  expect(game.facilities.map((f) => f.startingAssetId).sort()).toEqual(
    SCENARIOS.find((s) => s.id === 110)!
      .facilities.map((f) => f.assetId)
      .sort(),
  );
  expect(new Set(game.facilities.map((f) => f.startingAssetId)).size).toBe(
    game.facilities.length,
  );
});

test("common official compilation attaches rules without assigning community provenance or identity", () => {
  const base = SCENARIOS.find((s) => s.id === 113)!;
  const compiled = compileScenarioRules(
    { objectives: inheritedModObjectives(base) },
    {
      ...params,
      namespace: { kind: "official", scenarioId: 113, arcId: "load-shedding" },
      startingYear: base.startingYear,
      durationMonths: base.durationMonths,
      startingAssetIds: base.facilities.map((f) => f.assetId!),
    },
  );
  const official = { ...base, rules: compiled };
  expect(official.id).toBe(113);
  expect(official.mod).toBeUndefined();
  expect(official.seed).toBe(base.seed);
  expect(scenarioRules(official)).toBe(compiled);
  expect(validCompiledScenarioRules(compiled)).toBe(true);
});

test("objective intent explicitly inherits, adds, replaces or removes only scenario goals", () => {
  const inherit = modScenario({
    ...pack(),
    baseScenarioId: 100,
  });
  expect(inherit.mod!.rules.objectives.map((o) => o.id)).toContain(
    "base-100-retention",
  );
  const add = modScenario({
    ...pack(),
    baseScenarioId: 100,
    objectives: [
      ...inheritedModObjectives(SCENARIOS.find((s) => s.id === 100)!),
      {
        id: "debt",
        label: "Limit debt",
        metric: "monthEndDebt",
        fromMonth: 1,
        throughMonth: 12,
        maxDebtDollars: 1000,
      },
    ],
  });
  expect(add.mod!.rules.objectives).toHaveLength(
    inherit.mod!.rules.objectives.length + 1,
  );
  const none = modScenario({
    ...pack(),
    baseScenarioId: 100,
    officialArcs: [],
    scenario: { durationMonths: 6 },
    objectives: [],
  });
  expect(none.minimumCustomerRetention).toBeUndefined();
  expect(none.mod!.rules.objectives).toEqual([]);
  const replace = modScenario({
    ...pack(),
    baseScenarioId: 100,
    officialArcs: [],
    scenario: { durationMonths: 6 },
    objectives: [
      {
        id: "bills",
        label: "Limit bills",
        metric: "monthlyBilledRate",
        fromMonth: 1,
        throughMonth: 6,
        maxDollarsPerKWh: 0.1,
      },
    ],
  });
  expect(replace.mod!.rules.objectives.map((o) => o.id)).toEqual(["bills"]);
});

test("package and runtime digests ignore editor metadata and collection order, but move on meaning", () => {
  const original = {
    ...pack(),
    events: [
      { ...event("a"), startMonth: 1 },
      { ...event("b"), startMonth: 13 },
    ],
  };
  const reordered = {
    ...original,
    $schema: "./offline.schema.json",
    events: [...original.events].reverse(),
  };
  expect(packageDigest(original)).toBe(packageDigest(reordered));
  const a = modScenario(original),
    b = modScenario(reordered);
  expect(a.mod!.runtimeDigest).toBe(b.mod!.runtimeDigest);
  expect(JSON.stringify(a.mod)).not.toContain("$schema");
  const changed = modScenario({
    ...original,
    events: [
      { ...original.events[0], message: "A semantic change." },
      original.events[1],
    ],
  });
  expect(changed.mod!.runtimeDigest).not.toBe(a.mod!.runtimeDigest);
  expect(changed.mod!.packageDigest).not.toBe(a.mod!.packageDigest);
});

test("normalized snapshots reject hostile edits even when an attacker recomputes the content digest", () => {
  const scenario = modScenario({
    ...pack(),
    events: [{ ...event(), startMonth: 2 }],
  });
  expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 42,
    difficulty: "Employee",
  });
  for (const mutate of [
    (m: ScenarioModType) => Object.assign(m, { runtimeVersion: 2 }),
    (m: ScenarioModType) =>
      Object.assign(m.rules.namespace, {
        kind: "official",
        scenarioId: 100,
        arcId: "carbon-fee",
      }),
    (m: ScenarioModType) =>
      Object.assign(m.rules.events[0].effects, { evaluate: "cash * 2" }),
    (m: ScenarioModType) => {
      m.rules.events[0].startMonth += 1;
    },
    (m: ScenarioModType) => {
      m.rules.startingAssetIds = ["invented-asset"];
    },
    (m: ScenarioModType) => {
      m.rules.events[0].effects.hydroRunoffMultiplier = 11;
    },
  ]) {
    const save = roundTrip(game);
    mutate(save.game.customScenario.mod);
    save.game.customScenario.mod.runtimeDigest = modRuntimeDigest(
      save.game.customScenario.mod,
    );
    expect(parseSave(save)).toBeNull();
  }
  const saved = roundTrip(game);
  expect(parseSave(saved)?.game.customScenario?.mod).toEqual(scenario.mod);
});

test("runtime identity binds every resolved setup field and validates the complete transferred scenario", () => {
  const scenario = modScenario({ ...pack(), baseScenarioId: 114 });
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 42,
    difficulty: "Employee",
  });
  for (const mutate of [
    (s: typeof scenario) => {
      s.cash += 1;
    },
    (s: typeof scenario) => {
      s.dollarsPerkWh += 0.001;
    },
    (s: typeof scenario) => {
      s.feePerKgCO2e += 0.001;
    },
    (s: typeof scenario) => {
      s.ownership = s.ownership === "Investor" ? "Public" : "Investor";
    },
    (s: typeof scenario) => {
      s.facilities[0].peakW! += 1e6;
    },
    (s: typeof scenario) => {
      s.loadAdditions![0].startsYear += 1;
    },
    (s: typeof scenario) => {
      s.location!.lat += 1;
    },
  ]) {
    const save = roundTrip(game);
    mutate(save.game.customScenario);
    expect(parseSave(save)).toBeNull();
  }
  const changed = modScenario({
    ...pack(),
    baseScenarioId: 114,
    scenario: { cash: scenario.cash + 1 },
  });
  expect(validScenarioMod(changed.mod, changed)).toBe(true);
  expect(changed.mod!.runtimeDigest).not.toBe(scenario.mod!.runtimeDigest);
  for (const cash of [-1, 1e308]) {
    const edited = JSON.parse(JSON.stringify(scenario));
    edited.cash = cash;
    edited.mod.setupDigest = modSetupDigest(edited);
    edited.mod.runtimeDigest = modRuntimeDigest(edited.mod);
    expect(validScenarioMod(edited.mod, edited)).toBe(false);
  }
});

test("untrusted custom scenarios cannot attach trusted rules while omitting mod provenance", () => {
  const officialRules = compileScenarioRules(
    { objectives: [] },
    {
      ...params,
      namespace: { kind: "official", scenarioId: 100, arcId: "carbon-fee" },
    },
  );
  const forged = { ...DEFAULT_CUSTOM_SCENARIO, rules: officialRules };
  expect(scenarioRules(forged)).toBeUndefined();
  expect(() =>
    createGame({
      scenarioId: 999,
      scenario: forged,
      seed: 42,
      difficulty: "Employee",
    }),
  ).toThrow(/validated Modded/);
  const dispatch = jest.fn();
  expect(() => launchCustomScenario(dispatch, forged, "Employee")).toThrow(
    /invalid/,
  );
  expect(dispatch).not.toHaveBeenCalled();
  expect(() =>
    matchScenario({
      scenarioId: 999,
      customScenario: forged,
      difficulty: "Employee",
    }),
  ).toThrow();
  expect(
    validBrowseState({
      session: "test",
      revision: 1,
      phase: "browsing",
      card: "CUSTOM_GAME",
      difficulty: "Employee",
      custom: forged,
    }),
  ).toBe(false);
  const regular = createGame({
    scenarioId: 999,
    scenario: DEFAULT_CUSTOM_SCENARIO,
    seed: 42,
    difficulty: "Employee",
  });
  const saved = roundTrip(regular);
  saved.game.customScenario.rules = officialRules;
  expect(parseSave(saved)).toBeNull();
});

test("compiled byte ceiling counts normalized content independently of the package file ceiling", () => {
  const events: RuleEvent[] = Array.from({ length: 100 }, (_, i) => ({
    ...event(`event-${i}`),
    title: "T".repeat(100),
    message: "M".repeat(500),
    preview: "P".repeat(200),
    endMessage: "E".repeat(500),
    effects: {
      outputMultipliersBySelector: Array.from({ length: 10 }, () => ({
        target: {
          selector: "startingAsset" as const,
          assetId: "original-reactor",
        },
        outputMultiplier: 0.5,
      })),
    },
  }));
  const choices = Array.from({ length: 32 }, (_, i) => ({
    id: `choice-${i}`,
    title: "C".repeat(100),
    prompt: "P".repeat(500),
    dueMonth: 1,
    options: Array.from({ length: 8 }, (_, j) => ({
      id: `option-${j}`,
      label: "L".repeat(100),
      description: "D".repeat(500),
      message: "M".repeat(500),
      costDollars: 0,
    })),
  }));
  expect(() =>
    compileScenarioRules({ events, choices, objectives: [] }, params),
  ).toThrow(RuleCompilationError);
  expect(() =>
    compileScenarioRules({ events, choices, objectives: [] }, params),
  ).toThrow(/512 KiB/);
});

test("selected difficulty is enforced by save, initialization and launch boundaries", () => {
  const scenario = modScenario(pack(), undefined, "Employee");
  const game = createGame({
    scenarioId: 999,
    scenario,
    seed: 42,
    difficulty: "Employee",
  });
  const save = roundTrip(game);
  save.game.difficulty = "CEO";
  expect(parseSave(save)).toBeNull();
  expect(() =>
    createGame({ scenarioId: 999, scenario, seed: 42, difficulty: "CEO" }),
  ).toThrow(/runtime snapshot is invalid/);
  const dispatch = jest.fn();
  expect(() => launchCustomScenario(dispatch, scenario, "CEO")).toThrow(
    /runtime snapshot is invalid/,
  );
  expect(dispatch).not.toHaveBeenCalled();
});

test("the transfer ceiling includes enclosing setup without serializing rules twice", () => {
  const scenario = modScenario({ ...pack(), scenario: { durationMonths: 36 } });
  const mod = scenario.mod!,
    compiledParameters = {
      ...params,
      startingPeakW: mod.rules.startingPeakW,
      startingAssetIds: mod.rules.startingAssetIds,
    };
  const events: RuleEvent[] = Array.from({ length: 100 }, (_, i) => ({
    ...event(`large-event-${i}`),
    title: "T".repeat(100),
    message: "M".repeat(500),
    preview: "P".repeat(200),
    endMessage: "E".repeat(500),
    effects: {
      outputMultipliersBySelector: Array.from({ length: 10 }, () => ({
        target: {
          selector: "startingAsset" as const,
          assetId: mod.rules.startingAssetIds[0],
        },
        outputMultiplier: 0.5,
      })),
    },
  }));
  const definitions = (padding: number): ScenarioRuleDefinitions => ({
    events,
    objectives: [],
    choices: Array.from({ length: 32 }, (_, i) => ({
      id: `large-choice-${i}`,
      title: "C".repeat(100),
      prompt: "P".repeat(500),
      dueMonth: 1,
      options: Array.from({ length: 8 }, (_, j) => ({
        id: `option-${j}`,
        label: "L".repeat(100),
        description: "D".repeat(padding),
        message: "M".repeat(padding),
        costDollars: 0,
      })),
    })),
  });
  let low = 1,
    high = 500;
  while (low < high) {
    const padding = Math.ceil((low + high) / 2);
    try {
      mod.rules = compileScenarioRules(
        definitions(padding),
        compiledParameters,
      );
      mod.runtimeDigest = modRuntimeDigest(mod);
      if (JSON.stringify(mod).length < 512 * 1024) low = padding;
      else high = padding - 1;
    } catch (error) {
      if (!(error instanceof RuleCompilationError)) throw error;
      high = padding - 1;
    }
  }
  mod.rules = compileScenarioRules(definitions(low), compiledParameters);
  mod.runtimeDigest = modRuntimeDigest(mod);
  const gap = 512 * 1024 - 1 - JSON.stringify(mod).length;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(1500);
  mod.source.description += "x".repeat(gap);
  mod.runtimeDigest = modRuntimeDigest(mod);
  expect(JSON.stringify(mod).length).toBe(512 * 1024 - 1);
  expect(scenario.rules).toBeUndefined();
  expect(JSON.stringify(scenario).length).toBeGreaterThan(512 * 1024);
  expect(validScenarioMod(mod)).toBe(true);
  expect(validScenarioMod(mod, scenario)).toBe(false);
  mod.rules.events.pop();
  mod.runtimeDigest = modRuntimeDigest(mod);
  expect(validScenarioMod(mod, scenario)).toBe(true);
});

test("reordered arcs and commuting effect operations keep both content identities", () => {
  const original: ModPackage = {
    ...pack(),
    officialArcs: [
      { scenarioId: 103, includeChoices: true },
      { scenarioId: 100, includeChoices: false },
    ],
    events: [
      {
        ...event(),
        effects: {
          outputMultipliersBySelector: [
            {
              target: { selector: "largestOperating", fuel: "Coal" },
              outputMultiplier: 0.5,
            },
            {
              target: {
                selector: "oldestOperating",
                fuel: "Natural Gas",
                count: 1,
              },
              outputMultiplier: 0.75,
            },
          ],
          transactions: [
            { kind: "grant", amountDollars: 100 },
            { kind: "charge", amountDollars: 10 },
          ],
        },
      },
    ],
  };
  const reordered: ModPackage = {
    ...original,
    officialArcs: [...original.officialArcs!].reverse(),
    events: [
      {
        ...original.events![0],
        effects: {
          outputMultipliersBySelector: [
            ...original.events![0].effects!.outputMultipliersBySelector!,
          ].reverse(),
          transactions: [
            ...original.events![0].effects!.transactions!,
          ].reverse(),
        },
      },
    ],
  };
  expect(packageDigest(original)).toBe(packageDigest(reordered));
  const a = modScenario(original),
    b = modScenario(reordered);
  expect(a.mod!.setupDigest).toBe(b.mod!.setupDigest);
  expect(a.mod!.runtimeDigest).toBe(b.mod!.runtimeDigest);
  expect(a.mod!.rules).toEqual(b.mod!.rules);
});
