const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { summarize, reproduce, summarizeHistory } = require("./failures");

const line = (job, text) =>
  `${job}\tUNKNOWN STEP\t2026-10-17T18:53:11.6775880Z ${text}`;

test("history groups recurring journeys across viewports, branches and shifted line numbers without double counting fan-in", () => {
  const log = (project, lineNumber) =>
    summarize(
      [
        line("macOS ARM64 tests", "1 flaky"),
        line(
          "macOS ARM64 tests",
          `[${project}] › e2e/steam-input.spec.ts:${lineNumber}:5 › invite entry`,
        ),
        line("macOS ARM64 tests", "Controller journeys: FAILED"),
        line("check", "##[error]Process completed with exit code 1."),
      ].join("\n"),
    );
  const first = log("deck-720-dark", 637);
  first.set(
    "another viewport",
    log("mobile-390px", 637).get("macOS ARM64 tests"),
  );
  const result = summarizeHistory([
    {
      databaseId: 1,
      headBranch: "one",
      conclusion: "failure",
      url: "run/1",
      summary: first,
    },
    {
      databaseId: 2,
      headBranch: "two",
      conclusion: "failure",
      url: "run/2",
      summary: log("mobile-360px", 645),
    },
    { databaseId: 3, headBranch: "one", conclusion: "success" },
    { databaseId: 4, headBranch: "three", conclusion: "cancelled" },
  ]);
  assert.deepEqual(result.totals, {
    success: 1,
    failure: 2,
    cancelled: 1,
    other: 0,
  });
  assert.deepEqual(result.gates, [["Controller journeys", 2]]);
  assert.deepEqual(result.tests, [
    {
      test: "e2e/steam-input.spec.ts › invite entry",
      runs: 2,
      branches: 2,
      flakyRuns: 2,
      urls: ["run/1", "run/2"],
    },
  ]);
});

test("history retains unclassified build/setup failures instead of silently dropping them", () => {
  const result = summarizeHistory([
    {
      databaseId: 5,
      conclusion: "failure",
      url: "run/build",
      summary: summarize(
        line("Shared production builds", "Error: missing Electron runtime"),
      ),
    },
  ]);
  assert.equal(result.totals.failure, 1);
  assert.deepEqual(result.unclassified, ["run/build"]);
  assert.deepEqual(result.tests, []);
});

test("native test timeouts retain the original failure before secondary teardown errors", () => {
  const job = "macOS ARM64 tests";
  const errors = summarize(
    [
      line(job, "Test timeout of 120000ms exceeded."),
      line(
        job,
        'Test timeout of 120000ms exceeded while running "afterEach" hook.',
      ),
      line(job, "##[error]Worker teardown timeout of 120000ms exceeded."),
    ].join("\n"),
  ).get(job).errors;
  assert.deepEqual(errors, [
    "Test timeout of 120000ms exceeded.",
    'Test timeout of 120000ms exceeded while running "afterEach" hook.',
    "Worker teardown timeout of 120000ms exceeded.",
  ]);
});

test("summaries list failed gates, tests, flakes and assertion excerpts per job", () => {
  const mac = "macOS ARM64 tests";
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
      "npm run check -- --steps multiplayer",
      "e2e/desktop.spec.ts:180 runs only in CI (native windows); read its trace in the diagnostics artifact",
      "npm run build",
      "npm run test:e2e:production -- e2e/game-workspace.spec.ts:124 --project=mobile-390px",
    ],
  );
});

test("reproduction supports specs outside the CI allowlist and unnamed projects", () => {
  assert.deepEqual(
    reproduce([
      "[desktop-1440px] › e2e/scenario-details.spec.ts:12:5 › shows score",
      "e2e/scenario-details.spec.ts:20:5 › shows goals",
    ]),
    [
      "npm run build",
      "npm run test:e2e:production -- e2e/scenario-details.spec.ts:12 --project=desktop-1440px",
      "npm run test:e2e:production -- e2e/scenario-details.spec.ts:20",
    ],
  );
});

test("Jest durations, interleaved progress and timeout/assertion messages retain the failing gate", () => {
  const job = "Linux x64 tests";
  const summary = summarize(
    [
      line(job, "··FAIL src/components/views/Insights.test.tsx (164.975 s)"),
      line(job, "  ● Insights layers › zooms and pans every insight chart"),
      line(job, '    thrown: "Exceeded timeout of 15000 ms for a test.'),
      line(
        job,
        '    Use jest.setTimeout(newTimeout) to increase the timeout value."',
      ),
      line(
        job,
        "FAIL src/components/views/BuildGenerators.test.tsx (51.953 s)",
      ),
      line(job, "    expect(received).toBeNull()"),
      line(job, '    Received: <div role="dialog">still open</div>'),
    ].join("\n"),
  ).get(job);
  assert(summary.tests.includes("src/components/views/Insights.test.tsx"));
  assert(
    summary.tests.includes("src/components/views/BuildGenerators.test.tsx"),
  );
  assert(
    summary.errors.some((error) => error.includes("Exceeded timeout of 15000")),
  );
  assert(summary.errors.includes("expect(received).toBeNull()"));
  assert(summary.errors.some((error) => error.includes("still open")));
  assert.deepEqual(reproduce(summary.tests), [
    "npm run check -- --steps tests",
  ]);
});

test("simulation and all desktop-renderer failures select their actual local gates", () => {
  assert.deepEqual(
    reproduce([
      "src/testing/GoldenOutputs.sim.test.tsx",
      "e2e/mods.spec.ts:183:5 › desktop keyboard journey",
      "e2e/steam-input.spec.ts:200:5 › controller input",
    ]),
    [
      "npm run check -- --steps simulations",
      "npm run check -- --steps multiplayer",
      "npm run check -- --steps steam-input",
    ],
  );
});

test("transport evidence survives an unrelated downstream UI assertion", () => {
  const failure =
    "Network failure: GET /static/css/main.css (stylesheet): net::ERR_NO_BUFFER_SPACE";
  const summary = summarize(
    [
      line("Windows x64 tests", failure),
      line(
        "Windows x64 tests",
        "Error: expect(locator).toHaveCSS(expected) failed",
      ),
      line("Windows x64 tests", 'Expected: "solid"'),
      line("Windows x64 tests", 'Received: "none"'),
    ].join("\n"),
  );
  assert(summary.get("Windows x64 tests").errors.includes(failure));
});

// Exercise the command's real stdout/exit behavior while replacing only external commands.
function report(fixture) {
  return spawnSync(
    process.execPath,
    [
      "-e",
      `
      const assert = require("node:assert/strict");
      const fixture = ${JSON.stringify(fixture)};
      require("node:child_process").execFileSync = (command, args) => {
        if (command === "git") return fixture.run.headSha;
        assert.equal(command, "gh");
        if (args[0] === "run" && args.includes("--log-failed")) {
          assert.deepEqual(args, [
            "run", "view", "99", "--attempt", String(fixture.run.attempt), "--log-failed",
          ]);
          return fixture.log || "";
        }
        if (args[0] === "run" && args[1] === "view") return JSON.stringify(fixture.run);
        const endpoint = args.find(value => value.startsWith("repos/") || value.startsWith("https://"));
        assert.equal(args[0], "api");
        if (endpoint.includes("/actions/jobs/")) {
          const detail = fixture.details?.[endpoint.split("/").at(-1)];
          if (!detail) throw new Error("Job metadata unavailable");
          return JSON.stringify(detail);
        }
        assert.deepEqual(args.slice(0, 3), ["api", "--paginate", "--slurp"]);
        const annotations = fixture.annotations?.[endpoint];
        assert(annotations, "Only the selected job's annotations may be requested");
        return JSON.stringify(annotations);
      };
      require(${JSON.stringify(require.resolve("./failures"))}).main(["--run", "99"]);
    `,
    ],
    { encoding: "utf8" },
  );
}
const failedRun = (jobs, extra = {}) => ({
  attempt: 2,
  headSha: "abc12345",
  headBranch: "master",
  status: "completed",
  conclusion: "failure",
  url: "https://github.com/example/game/actions/runs/99",
  jobs,
  ...extra,
});
const job = (conclusion, extra = {}) => ({
  databaseId: 42,
  name: "macOS ARM64 build",
  status: "completed",
  conclusion,
  steps: [],
  url: "https://github.com/example/game/actions/runs/99/job/42",
  ...extra,
});
const detail = (extra = {}) => ({
  run_id: 99,
  run_attempt: 2,
  runner_id: 0,
  runner_name: "",
  labels: ["macos-15"],
  check_run_url: "https://api.github.com/repos/example/game/check-runs/142",
  ...extra,
});

test("the command reports cancelled unassigned workers and deduplicates paginated provisioning annotations", () => {
  const capacity =
    "Due to capacity constraints, jobs targeting macOS arm64 runners may experience longer queue times.";
  const result = report({
    run: failedRun([job("cancelled")]),
    details: { 42: detail() },
    annotations: {
      [`${detail().check_run_url}/annotations`]: [
        [
          {
            annotation_level: "failure",
            message:
              "The job was not acquired by Runner of type hosted even after multiple attempts",
          },
          { annotation_level: "notice", message: capacity },
        ],
        [{ annotation_level: "notice", message: capacity }],
      ],
    },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /CANCELLED macOS ARM64 build/);
  assert.match(result.stdout, /Runner: not assigned.*macos-15/);
  assert.match(result.stdout, /not acquired by Runner/);
  assert.equal(result.stdout.split(capacity).length - 1, 1);
  assert(result.stdout.includes(job("cancelled").url));
});

test("failed test summaries still include their assertions and reproduction commands for the selected attempt", () => {
  const result = report({
    run: failedRun([
      job("failure", {
        name: "Production browser tests",
        steps: [
          { name: "Complete production browser matrix", conclusion: "failure" },
        ],
      }),
    ]),
    details: { 42: detail({ runner_id: 7, runner_name: "hosted-runner" }) },
    annotations: { [`${detail().check_run_url}/annotations`]: [[]] },
    log: [
      line(
        "Production browser tests",
        "Error: expect(locator).toBeVisible() failed",
      ),
      line("Production browser tests", "1 failed"),
      line(
        "Production browser tests",
        "[desktop-chromium] › e2e/game-workspace.spec.ts:12:5 › opens",
      ),
    ].join("\n"),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    /FAILED Production browser tests: Complete production browser matrix/,
  );
  assert.match(result.stdout, /expect\(locator\).toBeVisible\(\) failed/);
  assert.match(
    result.stdout,
    /npm run test:e2e:production -- e2e\/game-workspace.spec.ts:12 --project=desktop-chromium/,
  );
  assert.match(result.stdout, /Runner: hosted-runner/);
});

test("non-successful completed jobs retain their actual outcomes even when runner diagnostics are unavailable", () => {
  for (const conclusion of [
    "timed_out",
    "abandoned",
    "action_required",
    "skipped",
  ]) {
    const result = report({ run: failedRun([job(conclusion)]) });
    assert.equal(result.status, 1, result.stderr);
    assert(
      result.stdout.includes(`${conclusion.toUpperCase()} macOS ARM64 build`),
    );
    assert.match(
      result.stdout,
      /Could not read runner diagnostics.*Job metadata unavailable/,
    );
    assert(!result.stdout.includes("capacity constraints"));
  }
});

test("annotations from another run or attempt are never attributed to the selected failure", () => {
  for (const mismatch of [{ run_id: 100 }, { run_attempt: 1 }]) {
    const result = report({
      run: failedRun([job("cancelled")]),
      details: { 42: detail(mismatch) },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stdout,
      /Could not read runner diagnostics.*different run or attempt/,
    );
    assert(!result.stdout.includes("capacity constraints"));
  }
});

test("successful runs and pending workers retain their existing exit semantics without invented failures", () => {
  const success = report({
    run: failedRun([job("success")], { conclusion: "success" }),
  });
  assert.equal(success.status, 0, success.stderr);
  assert(!success.stdout.includes("FAILED"));
  const pending = report({
    run: failedRun([job(null, { status: "queued" })], {
      status: "in_progress",
      conclusion: "",
    }),
  });
  assert.equal(pending.status, 2, pending.stderr);
  assert.match(pending.stdout, /Still running: macOS ARM64 build/);
  assert(!pending.stdout.includes("CANCELLED"));
});
