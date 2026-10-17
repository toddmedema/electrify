const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ESLint } = require("eslint");

const eslint = new ESLint();
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

test("simulation lint rejects ambient random draws and platform powers in every simulation entry path", async () => {
  for (const filePath of [
    "src/data/LintProbe.tsx",
    "src/helpers/LintProbe.ts",
    "src/reducers/LintProbe.tsx",
    "src/SaveGame.tsx",
    "src/testing/LintProbe.tsx",
    "src/workers/LintProbe.worker.ts",
  ]) {
    for (const expression of [
      "Math.random()",
      "Math['random']()",
      "Math.random",
      "Math.pow(2, exponent)",
      "value ** exponent",
      "value ** -exponent",
      "value ** +exponent",
      "value ** !(exponent)",
      "value ** -(exponent + 1)",
      "value **= 2",
    ]) {
      assert.equal(
        (await restrictions(expression + ";", filePath)).length,
        1,
        filePath + ": " + expression,
      );
    }
    assert.equal(
      (await restrictions("const { random: draw } = Math;", filePath)).length,
      1,
    );
  }
});

test("simulation lint permits deterministic helpers and the existing fixed powers", async () => {
  const code = `import { pow } from "./Pow";
    import { randomAt, normalAt, RANDOM_STREAM } from "./Math";
    export const values = [pow(2, exponent), randomAt(seed, RANDOM_STREAM.economy, 0),
      normalAt(seed, RANDOM_STREAM.weather, 0), value ** 2, 2 ** -1022, 2 ** +32];`;
  assert.deepEqual(await restrictions(code, "src/helpers/LintProbe.ts"), []);
});

test("simulation lint keeps test oracles and presentation math outside its scope", async () => {
  for (const filePath of [
    "src/helpers/LintProbe.test.tsx",
    "src/testing/LintProbe.sim.test.tsx",
    "src/components/base/LintProbe.tsx",
  ])
    assert.deepEqual(
      await restrictions(
        "Math.random(); Math.pow(2, exponent); value ** -exponent;",
        filePath,
      ),
      [],
    );
});
