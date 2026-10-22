const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function playwright(args, env = {}) {
  return spawnSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      ...args,
      "--reporter=json",
    ],
    {
      encoding: "utf8",
      maxBuffer: 20e6,
      windowsHide: true,
      env: { ...process.env, ...env },
    },
  );
}

test("production reproduction and CI use the same server and acceptance policy", () => {
  for (const hosted of ["false", "true"]) {
    const configs = ["production", "ci"].map((name) => {
      const result = playwright(
        [`--config=e2e/${name}.playwright.config.ts`, "--list"],
        { GITHUB_ACTIONS: hosted, CI: "true", E2E_PORT: "3187" },
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout).config;
    });
    for (const config of configs) {
      assert.equal(config.webServer.command, "node scripts/ci/serve.js");
      assert.equal(config.webServer.reuseExistingServer, false);
      assert.equal(config.webServer.url, "http://127.0.0.1:3187");
      assert.equal(config.forbidOnly, true);
      assert.equal(config.failOnFlakyTests, true);
      assert(config.projects.every((project) => project.retries === 2));
      if (hosted === "true") assert.equal(config.workers, 2);
    }
    assert.deepEqual(configs[0].webServer, configs[1].webServer);
    assert.equal(configs[0].workers, configs[1].workers);
  }
  // The reproduction entry point must reach specs outside CI's smoke allowlist.
  const result = playwright([
    "--config=e2e/production.playwright.config.ts",
    "scenario-details.spec.ts",
    "--project=desktop-1440px",
    "--list",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert(JSON.parse(result.stdout).suites.length > 0);
});

test("a failed first attempt cannot become a green production gate on retry", (t) => {
  const parent = path.resolve(".tmp", "production-policy-tests");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, "run-"));
  t.after(() => {
    assert(directory.startsWith(parent + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const config = path.join(directory, "playwright.config.ts");
  fs.writeFileSync(
    config,
    `
    import production from ${JSON.stringify(path.resolve("e2e/production.playwright.config").replaceAll("\\", "/"))};
    export default { ...production, testDir: '.', testMatch: 'policy.spec.ts',
      projects: [{ name: 'policy' }], workers: 1, webServer: undefined,
      outputDir: ${JSON.stringify(path.join(directory, "results"))} };
  `,
  );
  // These use the runner without requesting a browser: the regression is its exit status.
  fs.writeFileSync(
    path.join(directory, "policy.spec.ts"),
    `
    import { test, expect } from '@playwright/test';
    test('stable', () => expect(true).toBe(true));
    test('flaky', ({}, info) => expect(info.retry).toBeGreaterThan(0));
  `,
  );
  const stable = playwright([`--config=${config}`, "--grep=stable"]);
  assert.equal(stable.status, 0, stable.stderr || stable.stdout);
  const flaky = playwright([`--config=${config}`, "--grep=flaky"]);
  const report = JSON.parse(flaky.stdout);
  assert.equal(report.stats.flaky, 1);
  assert.equal(report.stats.unexpected, 0, "the retry really passed");
  assert.equal(flaky.status, 1, "a passed retry must still fail the gate");
});
