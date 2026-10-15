const { test } = require("node:test");
const assert = require("node:assert/strict");
const requireHeadedDesktop = require("../scripts/desktop-test-setup.js");

test("desktop tests reject Playwright's implicit and explicit headless modes", () => {
  for (const use of [{}, { headless: true }]) {
    assert.throws(
      () => requireHeadedDesktop({ projects: [{ use }] }),
      /npm run test:e2e.*npm run test:desktop -- --headed/,
    );
  }
});

test("desktop tests allow an explicit headed run", () => {
  assert.doesNotThrow(() =>
    requireHeadedDesktop({ projects: [{ use: { headless: false } }] }),
  );
});

test("every desktop project must explicitly opt in to native windows", () => {
  assert.throws(() =>
    requireHeadedDesktop({
      projects: [{ use: { headless: false } }, { use: {} }],
    }),
  );
});
