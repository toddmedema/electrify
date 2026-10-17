const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ESLint } = require("eslint");

const eslint = new ESLint();
const simulationPaths = [
  "src/data/LintProbe.tsx",
  "src/helpers/LintProbe.ts",
  "src/reducers/LintProbe.tsx",
  "src/SaveGame.tsx",
  "src/testing/LintProbe.tsx",
  "src/workers/LintProbe.worker.ts",
];

async function restrictions(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  assert(
    !result.messages.some((message) => message.fatal),
    JSON.stringify(result.messages),
  );
  return result.messages.filter((message) =>
    ["no-restricted-properties", "no-restricted-syntax"].includes(
      message.ruleId,
    ),
  );
}

test("simulation lint rejects ambient draws, aliases and computed or unsafe literal powers", async () => {
  for (const filePath of simulationPaths) {
    for (const expression of [
      "Math.random()",
      "Math['random']()",
      "Math.random",
      "Math.pow(2, exponent)",
      "Math['pow'](value, exponent)",
      "const { random: draw } = Math",
      "const { pow: power } = Math",
      "value ** exponent",
      "value ** -exponent",
      "value ** +exponent",
      "value ** !(exponent)",
      "value ** -(exponent + 1)",
      "value **= 2",
      "value ** 0.1",
      "value ** -0.1",
      "2 ** 0.1",
      "2 ** -0.1",
      "value ** 3",
      "value ** -2",
      // A pinned cross-platform mismatch in helpers/Pow.test.ts, missed by the old selector.
      "2.70816 ** 3.711",
    ]) {
      assert.equal(
        (await restrictions(expression + ";", filePath)).length,
        1,
        filePath + ": " + expression,
      );
    }
  }
});

test("qualified global Math access cannot bypass the direct-Math restrictions", async () => {
  for (const filePath of simulationPaths) {
    for (const globalName of ["globalThis", "window", "self", "global"]) {
      for (const code of [
        globalName + ".Math.random();",
        globalName + "['Math']['pow'](value, exponent);",
        "const { random: draw } = " + globalName + ".Math;",
        "const { Math: math } = " + globalName + ";",
      ])
        assert.equal(
          (await restrictions(code, filePath)).length,
          1,
          filePath + ": " + code,
        );
    }
  }
});

test("simulation lint permits deterministic helpers, squares and exact powers of two", async () => {
  const code = `import { pow } from "./Pow";
    import { randomAt, normalAt, RANDOM_STREAM } from "./Math";
    export const values = [pow(2, exponent), randomAt(seed, RANDOM_STREAM.economy, 0),
      normalAt(seed, RANDOM_STREAM.weather, 0), Math.sin(value) ** 2,
      value ** 2, value ** 2.0, 2 ** 0, 2 ** 32, 2 ** -1022, 2 ** +32, 2 ** 1_009,
      Math.max(value, 0)];`;
  for (const filePath of simulationPaths)
    assert.deepEqual(await restrictions(code, filePath), [], filePath);
});

test("simulation lint keeps test and spec oracles and presentation math outside its scope", async () => {
  for (const filePath of [
    "src/helpers/LintProbe.test.tsx",
    "src/helpers/LintProbe.spec.ts",
    "src/data/LintProbe.spec.tsx",
    "src/reducers/LintProbe.spec.tsx",
    "src/testing/LintProbe.sim.test.tsx",
    "src/testing/LintProbe.spec.ts",
    "src/workers/LintProbe.spec.ts",
    "src/components/base/LintProbe.tsx",
  ])
    assert.deepEqual(
      await restrictions(
        "Math.random(); Math.pow(2, exponent); value ** -exponent; globalThis.Math.random();",
        filePath,
      ),
      [],
      filePath,
    );
});
