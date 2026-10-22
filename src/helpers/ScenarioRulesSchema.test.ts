import {
  isRuleJson,
  ruleDiagnostics,
  RULE_DIFFICULTIES,
} from "./ScenarioRulesSchema";

const event = () => ({
  id: "dry-year",
  title: "A dry year",
  message: "Water inflow has fallen.",
  startMonth: 1,
});
const mechanicalEvent = (effects: unknown) => ({
  events: [
    {
      ...event(),
      durationMonths: 12,
      preview: "Water inflow will fall.",
      effects,
    },
  ],
});
const option = () => ({
  id: "keep-budget",
  label: "Keep the budget",
  description: "Keep cash for construction.",
  message: "The construction budget is unchanged.",
  costDollars: 0,
});
const choice = () => ({
  id: "response",
  title: "Respond to the drought",
  prompt: "Choose a response for your grid.",
  dueMonth: 1,
  options: [option(), { ...option(), id: "prepare" }],
});

describe("plain finite JSON boundary", () => {
  test.each([
    ["a function", () => {}],
    ["undefined", undefined],
    ["NaN", NaN],
    ["positive infinity", Infinity],
    ["negative infinity", -Infinity],
    ["a symbol", Symbol("hidden")],
    ["a date", new Date("2026-01-01T00:00:00Z")],
    ["a map", new Map([["event", "dry-year"]])],
    ["a boxed number", Object(1)],
    ["a custom prototype", Object.create({ inherited: true })],
    ["a sparse array", new Array(2)],
  ])("rejects %s instead of losing it during JSON cloning", (_label, value) => {
    expect(isRuleJson(value)).toBe(false);
    expect(ruleDiagnostics({ events: value })).toEqual([
      expect.objectContaining({ code: "invalid-json", severity: "error" }),
    ]);
  });

  test("rejects accessors and toJSON callbacks without invoking them", () => {
    const getter = jest.fn(() => event());
    const toJSON = jest.fn(() => ({ events: [event()] }));
    const accessor = Object.defineProperty({}, "events", {
      enumerable: true,
      get: getter,
    });
    for (const value of [accessor, { toJSON }]) {
      expect(ruleDiagnostics(value)).toEqual([
        expect.objectContaining({ code: "invalid-json" }),
      ]);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  test("rejects symbol and non-enumerable properties rather than dropping them", () => {
    for (const value of [
      { [Symbol("effect")]: 1 },
      Object.defineProperty({}, "effect", { value: 1 }),
      Object.assign([1], { hidden: 2 }),
    ])
      expect(isRuleJson(value)).toBe(false);
  });

  test("rejects cycles while accepting a repeated detached-JSON value", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isRuleJson(cyclic)).toBe(false);
    const repeated = { valid: [0, null, "safe", false] };
    expect(isRuleJson({ first: repeated, second: repeated })).toBe(true);
    expect(isRuleJson(Object.assign(Object.create(null), repeated))).toBe(true);
    expect(isRuleJson(Object.freeze({ valid: Object.freeze([1, 2]) }))).toBe(
      true,
    );
  });

  test("rejects nonplain arrays before inherited iteration can run", () => {
    const iterate = jest.fn();
    class HostileArray extends Array<unknown> {
      forEach() {
        iterate();
      }
    }
    const diagnostics = ruleDiagnostics({
      events: new HostileArray(event()),
    });
    expect(iterate).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "invalid-json" }),
    ]);
    expect(isRuleJson(Object.setPrototypeOf([], null))).toBe(false);
  });
});

describe("diagnostic paths on malformed rule items", () => {
  test.each([
    "events",
    "choices",
    "objectives",
    "debriefReports",
    "officialArcs",
  ])("%s rejects each null or falsy item without throwing", (collection) => {
    for (const value of [null, false, 0, "", [], "invalid"]) {
      expect(() => ruleDiagnostics({ [collection]: [value] })).not.toThrow();
      expect(ruleDiagnostics({ [collection]: [value] })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-object",
            path: `${collection}[0]`,
            severity: "error",
          }),
        ]),
      );
    }
  });

  test.each(["constructor", "__proto__", "toString", "unknown-metric"])(
    "unknown metric %s is a diagnostic, never a prototype lookup",
    (metric) => {
      const definitions = {
        objectives: [
          {
            id: "goal",
            label: "Keep demand served",
            metric,
            fromMonth: 1,
            throughMonth: 12,
          },
        ],
      };
      expect(() => ruleDiagnostics(definitions)).not.toThrow();
      expect(ruleDiagnostics(definitions)).toContainEqual(
        expect.objectContaining({
          code: "invalid-value",
          path: "objectives[0].metric",
        }),
      );
    },
  );

  test.each(["constructor", "__proto__", "toString", "unknown-selector"])(
    "unknown selector %s is a diagnostic, never inherited behavior",
    (selector) => {
      const definitions = mechanicalEvent({
        outputMultipliersBySelector: [
          { target: { selector }, outputMultiplier: 0.5 },
        ],
      });
      expect(() => ruleDiagnostics(definitions)).not.toThrow();
      expect(ruleDiagnostics(definitions)).toContainEqual(
        expect.objectContaining({
          code: "invalid-value",
          path: "events[0].effects.outputMultipliersBySelector[0].target.selector",
        }),
      );
    },
  );

  test("retains every independent unknown nested field with its prefix", () => {
    const definitions = {
      surpriseField: true,
      events: [
        {
          ...event(),
          durationMonths: 1,
          preview: "Gas costs will rise.",
          effects: {
            expression: "cash * 2",
            fuelPriceMultipliers: { "Natural Gas": 1, Imports: 2 },
          },
        },
      ],
    };
    expect(ruleDiagnostics(definitions, "rules")).toEqual(
      expect.arrayContaining(
        [
          "rules.surpriseField",
          "rules.events[0].effects.expression",
          "rules.events[0].effects.fuelPriceMultipliers.Imports",
        ].map((path) =>
          expect.objectContaining({ code: "unknown-field", path }),
        ),
      ),
    );
  });

  test("null nested options, effects, loads and reports keep their own paths", () => {
    const cases = [
      {
        definition: {
          choices: [{ ...choice(), options: [null, option()] }],
        },
        path: "choices[0].options[0]",
      },
      {
        definition: mechanicalEvent({ transactions: [null] }),
        path: "events[0].effects.transactions[0]",
      },
      {
        definition: mechanicalEvent({ outputMultipliersBySelector: [null] }),
        path: "events[0].effects.outputMultipliersBySelector[0]",
      },
      {
        definition: {
          events: [
            { ...event(), loads: [null], preview: "A load will connect." },
          ],
        },
        path: "events[0].loads[0]",
      },
      {
        definition: { events: [{ ...event(), report: null }] },
        path: "events[0].report",
      },
    ];
    for (const { definition, path } of cases) {
      expect(() => ruleDiagnostics(definition)).not.toThrow();
      expect(ruleDiagnostics(definition)).toContainEqual(
        expect.objectContaining({ code: "invalid-object", path }),
      );
    }
  });
});

interface NumericField {
  name: string;
  min: number;
  max: number;
  path: string;
  definition: (value: unknown) => unknown;
}
const numericFields: NumericField[] = [
  ...[
    ["fuelPriceMultipliers", 0.1, 10],
    ["outputMultipliersByFuel", 0, 1],
    ["constructionCostMultipliersByFuel", 0.1, 10],
    ["operatingCostMultipliersByFuel", 0.1, 10],
  ].map(([name, min, max]) => ({
    name: String(name),
    min: Number(min),
    max: Number(max),
    path: `events[0].effects.${name}.Coal`,
    definition: (value: unknown) =>
      mechanicalEvent({ [name]: { Coal: value } }),
  })),
  ...[
    ["demandMultiplier", 0.1, 10],
    ["temperatureOffsetC", -30, 30],
    ["hydroInflowMultiplier", 0, 10],
    ["operatingExpenseDollarsPerMonth", 0, 1e12],
    ["carbonFeeDollarsPerTonneCO2e", 0, 100000],
  ].map(([name, min, max]) => ({
    name: String(name),
    min: Number(min),
    max: Number(max),
    path: `events[0].effects.${name}`,
    definition: (value: unknown) => mechanicalEvent({ [name]: value }),
  })),
  {
    name: "durationMonths",
    min: 1,
    max: 1200,
    path: "events[0].durationMonths",
    definition: (value) => ({
      events: [{ ...event(), durationMonths: value }],
    }),
  },
  {
    name: "selector outputMultiplier",
    min: 0,
    max: 1,
    path: "events[0].effects.outputMultipliersBySelector[0].outputMultiplier",
    definition: (value) =>
      mechanicalEvent({
        outputMultipliersBySelector: [
          { target: { selector: "largestOperating" }, outputMultiplier: value },
        ],
      }),
  },
  {
    name: "targetCapacityShare",
    min: 0,
    max: 1,
    path: "events[0].effects.outputMultipliersBySelector[0].target.targetCapacityShare",
    definition: (value) =>
      mechanicalEvent({
        outputMultipliersBySelector: [
          {
            target: {
              selector: "seededOperatingCapacityShare",
              targetCapacityShare: value,
            },
            outputMultiplier: 0.5,
          },
        ],
      }),
  },
  {
    name: "transaction amountDollars",
    min: 0,
    max: 1e12,
    path: "events[0].effects.transactions[0].amountDollars",
    definition: (value) =>
      mechanicalEvent({
        transactions: [{ kind: "grant", amountDollars: value }],
      }),
  },
  ...["costDollars", "grantDollars"].map((name) => ({
    name,
    min: 0,
    max: 1e12,
    path: `choices[0].options[1].${name}`,
    definition: (value: unknown) => {
      const { costDollars: _cost, ...second } = option();
      return {
        choices: [
          {
            ...choice(),
            options: [option(), { ...second, id: "prepare", [name]: value }],
          },
        ],
      };
    },
  })),
];
const table = (value: number) =>
  Object.fromEntries(
    RULE_DIFFICULTIES.map((difficulty) => [difficulty, value]),
  );

describe.each(numericFields)("difficulty quantity $name", (field) => {
  test("accepts exact scalar and complete-table bounds", () => {
    for (const value of [field.min, field.max]) {
      expect(ruleDiagnostics(field.definition(value))).toEqual([]);
      expect(
        ruleDiagnostics(field.definition({ byDifficulty: table(value) })),
      ).toEqual([]);
    }
  });

  test.each(RULE_DIFFICULTIES)(
    "%s is validated, even when the other four values are valid",
    (difficulty) => {
      for (const value of [
        field.min - Math.max(1e-6, Math.abs(field.min) / 100),
        field.max + Math.max(1e-6, Math.abs(field.max) / 100),
      ]) {
        const values = { ...table(field.min), [difficulty]: value };
        expect(
          ruleDiagnostics(field.definition({ byDifficulty: values })),
        ).toContainEqual(
          expect.objectContaining({
            code: "number-bounds",
            path: `${field.path}.byDifficulty.${difficulty}`,
          }),
        );
      }
    },
  );

  test("rejects incomplete, extended, and nested difficulty tables", () => {
    const incomplete = table(field.min);
    delete incomplete.CEO;
    expect(
      ruleDiagnostics(field.definition({ byDifficulty: incomplete })),
    ).toContainEqual(
      expect.objectContaining({
        code: "number-bounds",
        path: `${field.path}.byDifficulty.CEO`,
      }),
    );
    expect(
      ruleDiagnostics(
        field.definition({ byDifficulty: { ...table(field.min), Founder: 1 } }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "unknown-field",
        path: `${field.path}.byDifficulty.Founder`,
      }),
    );
    expect(
      ruleDiagnostics(
        field.definition({
          byDifficulty: {
            ...table(field.min),
            Intern: { byDifficulty: table(field.min) },
          },
        }),
      ),
    ).toContainEqual(
      expect.objectContaining({
        code: "number-bounds",
        path: `${field.path}.byDifficulty.Intern`,
      }),
    );
  });
});

test("mechanical durations are whole months and meaningful zeros retain their scope", () => {
  expect(
    ruleDiagnostics({ events: [{ ...event(), durationMonths: 1.5 }] }),
  ).toContainEqual(
    expect.objectContaining({ path: "events[0].durationMonths" }),
  );
  expect(
    ruleDiagnostics(
      mechanicalEvent({
        outputMultipliersByFuel: { Coal: 0 },
        hydroInflowMultiplier: 0,
        carbonFeeDollarsPerTonneCO2e: 0,
        temperatureOffsetC: 0,
        operatingExpenseDollarsPerMonth: 0,
        transactions: [{ kind: "grant", amountDollars: 0 }],
      }),
    ),
  ).toEqual([]);
  expect(
    ruleDiagnostics(mechanicalEvent({ demandMultiplier: 0 })),
  ).toContainEqual(
    expect.objectContaining({ path: "events[0].effects.demandMultiplier" }),
  );
});

test("all eight objective metrics accept their own fields and reject another metric's target", () => {
  const window = { fromMonth: 1, throughMonth: 12 };
  const objectives = [
    { metric: "monthlyReliability", ...window, minDemandServedShare: 1 },
    { metric: "customerRetention", deadlineMonth: 12, minRetainedShare: 0.9 },
    { metric: "emissionsBudget", ...window, budgetTonnesCO2e: 0 },
    { metric: "emissionsPerDeliveredMWh", ...window, maxKgCO2ePerMWh: 500 },
    {
      metric: "localFuelShare",
      ...window,
      fuels: ["Sun", "Wind"],
      minShare: 0.5,
    },
    { metric: "fuelRetirement", deadlineMonth: 12, fuel: "Coal" },
    { metric: "monthlyBilledRate", ...window, maxDollarsPerKWh: 0.12 },
    { metric: "monthEndDebt", ...window, maxDebtDollars: 1000000 },
  ].map((definition, index) => ({
    id: `objective-${index}`,
    label: "A measurable goal",
    required: false,
    ...definition,
  }));
  expect(ruleDiagnostics({ objectives })).toEqual([]);
  expect(
    ruleDiagnostics({
      objectives: [{ ...objectives[0], maxDebtDollars: 0 }],
    }),
  ).toContainEqual(
    expect.objectContaining({
      code: "unknown-field",
      path: "objectives[0].maxDebtDollars",
    }),
  );
});

test("plain metadata labels are not mistaken for data URLs", () => {
  expect(
    ruleDiagnostics({
      events: [
        {
          ...event(),
          title: "Grid metadata: current",
          message: "Check your grid metadata: the opening year is correct.",
        },
      ],
    }),
  ).toEqual([]);
});

test.each([
  "Hidden\u202e",
  "<b>Markup</b>",
  "https://example.com",
  // Deliberately hostile fixture; the validator must reject it before use.
  // eslint-disable-next-line no-script-url
  "javascript:alert(1)",
  "data:text/plain;base64,SGVsbG8=",
])("unsafe authored text %s is rejected in the owning field", (title) => {
  expect(ruleDiagnostics({ events: [{ ...event(), title }] })).toContainEqual(
    expect.objectContaining({ code: "unsafe-text", path: "events[0].title" }),
  );
});
