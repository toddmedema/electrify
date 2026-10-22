import Ajv from "ajv";
import fs from "fs";
import path from "path";
import { createModEditorSchema } from "./ModEditorSchema";
import { createModRecipes, createAuthoringTemplate } from "./ModRecipes";
import {
  validateMod,
  modDiagnostics,
  SCENARIO_OVERRIDE_KEYS,
  FACILITY_NAMES,
  PROGRAM_KEYS,
} from "./ModSchema";
import { OBJECTIVE_DEFINITIONS } from "../helpers/ScenarioObjectiveDefinitions";

const schema = createModEditorSchema();
const validate = new Ajv({ allErrors: true, unicode: false }).compile(schema);
const recipes = Object.values(createModRecipes()).map(validateMod);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("the checked-in offline schema is generated from the tested editor contract", () => {
  expect(
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../..", "docs/mods/scenario.schema.json"),
        "utf8",
      ),
    ),
  ).toEqual(schema);
  const properties = schema.properties as Record<
    string,
    { properties?: Record<string, unknown> }
  >;
  expect(Object.keys(properties.scenario.properties!).sort()).toEqual(
    [...SCENARIO_OVERRIDE_KEYS].sort(),
  );
  expect(Object.keys(properties.facilities.properties!).sort()).toEqual(
    [...FACILITY_NAMES].sort(),
  );
  expect(Object.keys(properties.programs.properties!).sort()).toEqual(
    [...PROGRAM_KEYS].sort(),
  );
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const value = node as Record<string, unknown>;
    for (const property of Object.values(
      (value.properties ?? {}) as Record<string, { description?: unknown }>,
    ))
      expect(typeof property.description).toBe("string");
    Object.values(value).forEach((child) =>
      Array.isArray(child) ? child.forEach(walk) : walk(child),
    );
  };
  walk(schema);
  for (const definition of Object.values(OBJECTIVE_DEFINITIONS))
    expect(JSON.stringify(schema)).toContain(definition);
  const definitions = fs.readFileSync(
    path.resolve(__dirname, "../..", "docs/mods/objective-definitions.md"),
    "utf8",
  );
  for (const definition of Object.values(OBJECTIVE_DEFINITIONS))
    expect(definitions).toContain(definition);
});

test("every executable recipe and the native template pass the same structural contract", () => {
  for (const pack of [...recipes, validateMod(createAuthoringTemplate())]) {
    expect(validate(pack)).toBe(true);
    expect(validateMod(pack)).toEqual(pack);
  }
});

test("editor structure and production parser agree on independent hostile fields and bounds", () => {
  let cases = 0;
  const verify = (value: unknown) => {
    const accepted = modDiagnostics(value).length === 0;
    expect({
      accepted: validate(value),
      errors: validate.errors ?? [],
    }).toEqual(expect.objectContaining({ accepted }));
    cases++;
  };
  for (const recipe of recipes) {
    verify(recipe);
    const explore = (value: unknown, keys: (string | number)[] = []) => {
      if (!value || typeof value !== "object") return;
      if (!Array.isArray(value)) {
        const mutated = clone(recipe) as unknown as Record<string, unknown>;
        let target: unknown = mutated;
        keys.forEach((key) => {
          target = (target as Record<string | number, unknown>)[key];
        });
        (target as Record<string, unknown>).unsupportedField = true;
        verify(mutated);
      }
      for (const [key, child] of Object.entries(value)) {
        const parts = [...keys, Array.isArray(value) ? Number(key) : key];
        if (["number", "string", "boolean"].includes(typeof child)) {
          const changed = clone(recipe);
          let target: unknown = changed;
          parts.slice(0, -1).forEach((part) => {
            target = (target as Record<string | number, unknown>)[part];
          });
          (target as Record<string | number, unknown>)[
            parts[parts.length - 1]
          ] =
            typeof child === "number"
              ? 1e300
              : typeof child === "boolean"
                ? "not-a-boolean"
                : 17;
          verify(changed);
        } else explore(child, parts);
      }
    };
    explore(recipe);
  }
  expect(cases).toBeGreaterThan(200);
});

test("text safety, complete difficulty values and objective scope unions have valid neighbors", () => {
  const pack = clone(recipes[0]);
  for (const title of [
    "Plain title",
    "x\u0000x",
    "<b>markup</b>",
    "https://example.com",
    " ",
  ]) {
    const candidate = { ...pack, title };
    expect(validate(candidate)).toBe(modDiagnostics(candidate).length === 0);
  }
  const valid = clone(pack);
  valid.events![0].effects!.demandMultiplier = {
    byDifficulty: { Intern: 1, Employee: 1.1, Manager: 1.2, VP: 1.3, CEO: 1.4 },
  };
  expect(validate(valid)).toBe(true);
  const incomplete = clone(valid) as unknown as {
    events: {
      effects: { demandMultiplier: { byDifficulty: Record<string, number> } };
    }[];
  };
  delete incomplete.events[0].effects.demandMultiplier.byDifficulty.CEO;
  expect(validate(incomplete)).toBe(false);
  expect(modDiagnostics(incomplete)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining("CEO") }),
    ]),
  );
  const objectives = clone(
    recipes.find((recipe) => recipe.id === "objective-recipes")!,
  );
  if (objectives.objectives.mode !== "replace")
    throw new Error("Objective fixture must replace goals");
  const wrongScope = clone(objectives) as unknown as {
    objectives: { items: Record<string, unknown>[] };
  };
  wrongScope.objectives.items[0].maxDebtDollars = 0;
  expect(validate(wrongScope)).toBe(false);
  expect(
    modDiagnostics(wrongScope).some((d) => d.code === "unknown-field"),
  ).toBe(true);
});

test("editor numeric unit boundaries agree with the parser at and beside each limit", () => {
  const cases: [string, number, number][] = [
    ["demandMultiplier", 0.1, 10],
    ["temperatureOffsetC", -30, 30],
    ["hydroInflowMultiplier", 0, 10],
    ["operatingExpenseDollarsPerMonth", 0, 1e12],
    ["carbonFeeDollarsPerTonneCO2e", 0, 100000],
  ];
  for (const [field, min, max] of cases)
    for (const value of [
      min - 0.01,
      min,
      max,
      max + Math.max(0.01, max * 0.001),
    ]) {
      const pack = clone(recipes[0]);
      (pack.events![0].effects as Record<string, unknown>)[field] = value;
      const expected = value >= min && value <= max;
      expect(validate(pack)).toBe(expected);
      expect(modDiagnostics(pack).length === 0).toBe(expected);
    }
  for (const value of [0.0009, 0.001, 100000, 100001]) {
    const pack = clone(
      recipes.find((recipe) => recipe.id === "choice-recipes")!,
    );
    pack.events![0].loads![0].peakMW = value;
    const expected = value >= 0.001 && value <= 100000;
    expect(validate(pack)).toBe(expected);
    expect(modDiagnostics(pack).length === 0).toBe(expected);
  }
});
