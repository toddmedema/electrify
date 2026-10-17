const { test } = require("node:test");
const assert = require("node:assert/strict");
const { summarize, reproduce } = require("./failures");

const line = (job, text) =>
  `${job}\tUNKNOWN STEP\t2026-10-17T18:53:11.6775880Z ${text}`;

test("summaries list failed gates, tests, flakes and assertion excerpts per job", () => {
  const mac = "macOS universal tests";
  const log = [
    line(mac, "Types: passed"),
    line(
      mac,
      "  1) [mobile-390px] › e2e\\game-workspace.spec.ts:124:5 › reopens ",
    ),
    line(mac, "    Error: expect(received).toBeGreaterThan(expected)"),
    line(mac, "    Expected: > 120"),
    line(mac, "    Error Context: test-results/x/error-context.md"),
    line(mac, "  1 failed"),
    line(
      mac,
      "    [mobile-390px] › e2e\\game-workspace.spec.ts:124:5 › reopens ",
    ),
    line(mac, "  1 flaky"),
    line(mac, "    [desktop-chromium] › e2e/music.spec.ts:131:5 › menus loop "),
    line(mac, "  61 passed (3.0m)"),
    `${mac}\tUNKNOWN STEP\t##[notice]  1 failed`,
    line(mac, "Production browser: FAILED"),
    line(mac, "  1 failed"),
    line(mac, "    e2e/multiplayer.spec.ts:904:7 › 4 players share a game "),
    line(mac, "Shared-clock Steam renderer: FAILED"),
    line("check", "##[error]Process completed with exit code 1."),
    line(
      "Shared production builds",
      "FAIL Main CSS  26.35 kB  ceiling 23.95 kB",
    ),
    line("Shared production builds", "FAIL src/helpers/Math.test.tsx"),
    line("Shared production builds", "  ● Math › pow rounds › exactly"),
    line("Shared production builds", "  ● Console"),
  ].join("\n");
  const jobs = summarize(log);
  assert.deepEqual([...jobs.keys()], [mac, "Shared production builds"]);
  assert.deepEqual(jobs.get(mac).gates, [
    "Production browser",
    "Shared-clock Steam renderer",
  ]);
  assert.deepEqual(jobs.get(mac).tests, [
    "[mobile-390px] › e2e/game-workspace.spec.ts:124:5 › reopens",
    "e2e/multiplayer.spec.ts:904:7 › 4 players share a game",
  ]);
  assert.deepEqual(jobs.get(mac).flaky, [
    "[desktop-chromium] › e2e/music.spec.ts:131:5 › menus loop",
  ]);
  assert.deepEqual(jobs.get(mac).errors, [
    "Error: expect(received).toBeGreaterThan(expected)",
    "Expected: > 120",
    "Error Context: test-results/x/error-context.md",
  ]);
  const build = jobs.get("Shared production builds");
  assert.deepEqual(build.tests, [
    "src/helpers/Math.test.tsx",
    "Math › pow rounds › exactly",
  ]);
  assert.deepEqual(build.errors, ["FAIL Main CSS  26.35 kB  ceiling 23.95 kB"]);
});

test("reproduction commands use the matching local gate for each Playwright project", () => {
  assert.deepEqual(
    reproduce([
      "[mobile-390px] › e2e/game-workspace.spec.ts:124:5 › reopens",
      "[mobile-390px] › e2e/game-workspace.spec.ts:124:5 › reopens",
      "e2e/multiplayer.spec.ts:904:7 › 4 players",
      "[electron] › e2e/desktop.spec.ts:180:5 › fresh install",
      "Math › pow rounds",
    ]),
    [
      "npm run build && npm run test:e2e:ci -- e2e/game-workspace.spec.ts:124 --project=mobile-390px",
      "npm run check -- --steps multiplayer",
      "e2e/desktop.spec.ts:180 runs only in CI (native windows); read its trace in the diagnostics artifact",
    ],
  );
});
