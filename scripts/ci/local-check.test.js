const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  steps,
  selectSteps,
  isFullCheck,
  workerCount,
  execute,
} = require("../check");
const { checkAssets } = require("../check-assets");

test("full checks retain every gate; partial checks reject unknown or injected names", () => {
  assert.deepEqual(
    selectSteps([]).map((step) => step.script),
    [
      "typecheck",
      "lint",
      "format:check",
      "test:desktop:native",
      "test:ci-tools",
      "test:ci",
      "test:sim",
      "sim",
    ],
  );
  assert.deepEqual(
    selectSteps(["--steps", "lint,tests,lint"]).map((step) => step.id),
    ["lint", "tests"],
  );
  assert.deepEqual(
    selectSteps(["--ci", "--steps", "multiplayer,browser"]),
    selectSteps(["--steps", "multiplayer,browser"]),
  );
  // --ci adds the gates that need a production build or browser, in CI's dependency order.
  assert.deepEqual(
    selectSteps(["--ci"])
      .filter((step) => step.ci)
      .map((step) => step.script),
    [
      "perf:bench",
      "build",
      "perf:bundle",
      "test:e2e:ci",
      "desktop:build",
      "test:multiplayer",
      "test:steam-input",
    ],
  );
  assert(isFullCheck(selectSteps([])));
  assert(isFullCheck(selectSteps(["--ci"])));
  assert(!isFullCheck(selectSteps(["--steps", "browser"])));
  // Retrying a browser suite rebuilds the renderer it tests, since both builds share build/.
  assert.deepEqual(
    selectSteps(["--steps", "multiplayer,browser"]).map((step) => step.id),
    ["build", "browser", "desktop-build", "multiplayer"],
  );
  assert.deepEqual(
    selectSteps(["--steps", "bundle"]).map((step) => step.id),
    ["build", "bundle"],
  );
  assert.deepEqual(
    selectSteps(["--steps", "steam-input"]).map((step) => step.id),
    ["desktop-build", "steam-input"],
  );
  for (const args of [
    ["--steps", ""],
    ["--steps", "lnti"],
    ["--steps", "lint;echo bad"],
    ["--steps"],
    ["--skip", "tests"],
    ["--ci", "--steps", ""],
    ["--ci", "--steps", "lnti"],
    ["--ci", "--ci"],
  ])
    assert.throws(() => selectSteps(args));
  assert.equal(workerCount({}, 20), 4);
  assert.equal(workerCount({}, 2), 2);
  assert.equal(workerCount({ ELECTRIFY_CHECK_WORKERS: "8" }), 8);
  for (const value of [
    "",
    "0",
    "-1",
    "2.5",
    "4 & echo bad",
    "99999999999999999",
  ])
    assert.throws(() => workerCount({ ELECTRIFY_CHECK_WORKERS: value }));
});

test("full and partial checks finish all gates after failures and never overlap heavy suites", async () => {
  for (const selected of [
    steps,
    selectSteps(["--steps", "lint,tests,simulations"]),
  ]) {
    let activeHeavy = 0;
    const visited = [];
    const results = await execute(selected, async (step) => {
      visited.push(step.id);
      if (!step.parallel) assert.equal(++activeHeavy, 1);
      await new Promise((resolve) => setImmediate(resolve));
      if (!step.parallel) activeHeavy--;
      return { ...step, ok: step.id !== "lint" };
    });
    assert.deepEqual(
      visited,
      selected.map((step) => step.id),
    );
    assert.equal(results.length, selected.length);
    assert.equal(results.find((result) => result.id === "lint").ok, false);
  }
});

test("a failed build skips the suites that test it and still runs later gates", async () => {
  const visited = [];
  const results = await execute(
    selectSteps(["--steps", "bundle,browser,multiplayer"]),
    async (step) => {
      visited.push(step.id);
      return { ...step, ok: step.id !== "build" };
    },
  );
  assert.deepEqual(visited, ["build", "desktop-build", "multiplayer"]);
  assert.equal(results.find((result) => result.id === "browser").ok, false);
  assert.equal(
    results.find((result) => result.id === "browser").status,
    "skipped",
  );
  assert.equal(results.find((result) => result.id === "bundle").ok, false);
});

test("asset preflight rejects pointers and missing tracked files, ignoring untracked files", (t) => {
  const parent = path.resolve(".tmp", "asset-preflight-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "repo-"));
  t.after(() => {
    assert(root.startsWith(parent + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git("init", "--quiet");
  fs.mkdirSync(path.join(root, "public"));
  const asset = path.join(root, "public", "sound.wav");
  fs.writeFileSync(
    asset,
    "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
  );
  git("-c", "core.autocrlf=false", "add", "public/sound.wav");
  assert.throws(
    () => checkAssets(root),
    /Git LFS pointers[\s\S]*public\/sound.wav/,
  );
  const blocked = spawnSync(
    process.execPath,
    [path.resolve("scripts/check.js")],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ELECTRIFY_CHECK_WORKERS: "2" },
    },
  );
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Asset preflight failed/);
  assert.doesNotMatch(blocked.stderr, /Starting /);
  fs.writeFileSync(asset, "RIFF real asset bytes");
  fs.writeFileSync(
    path.join(root, "public", "untracked.png"),
    "version https://git-lfs.github.com/spec/v1",
  );
  checkAssets(root);
  fs.unlinkSync(asset);
  assert.throws(
    () => checkAssets(root),
    (error) => {
      assert.match(
        error.message,
        /Missing tracked files[\s\S]*public\/sound.wav/,
      );
      assert.match(error.message, /intentional[\s\S]*git add -u/);
      assert.doesNotMatch(error.message, /git lfs (pull|checkout)/);
      return true;
    },
  );
  git("add", "-u");
  checkAssets(root);
});

test("asset preflight checks manual originals under docs/manual-images", (t) => {
  const parent = path.resolve(".tmp", "asset-preflight-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "manual-"));
  t.after(() => {
    assert(root.startsWith(parent + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git("init", "--quiet");
  const relative = "docs/manual-images/figure.png";
  const asset = path.join(root, relative);
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  fs.writeFileSync(
    asset,
    "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
  );
  git("-c", "core.autocrlf=false", "add", relative);
  assert.throws(
    () => checkAssets(root),
    /Git LFS pointers[\s\S]*docs\/manual-images\/figure\.png/,
  );
  fs.writeFileSync(asset, "real manual artwork");
  checkAssets(root);
  fs.unlinkSync(asset);
  assert.throws(
    () => checkAssets(root),
    /Missing tracked files[\s\S]*docs\/manual-images\/figure\.png/,
  );
});

test("the simulation CLI uses an in-process Jest run and a worktree-local cache", (t) => {
  const repoRoot = path.resolve(__dirname, "../..");
  const parent = path.join(repoRoot, ".tmp", "check-cli-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "sim-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preload = path.join(root, "show-config.cjs");
  // Ask the CLI's actual Jest invocation for its resolved config, without running a simulation.
  fs.writeFileSync(
    preload,
    `const cp = require('node:child_process');
     const spawn = cp.spawnSync;
     cp.spawnSync = (command, args, options) => {
       const result = spawn(command, [...args, '--showConfig'], {
         ...options, stdio: 'pipe', encoding: 'utf8'
       });
       process.stdout.write(result.stdout || '');
       process.stderr.write(result.stderr || '');
       return result;
     };`,
  );
  const result = spawnSync(
    process.execPath,
    ["--require", preload, path.join(repoRoot, "scripts", "sim.js")],
    { encoding: "utf8", windowsHide: true, cwd: repoRoot },
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.globalConfig.maxWorkers, 1);
  assert.equal(
    path.resolve(config.configs[0].cacheDirectory),
    path.join(repoRoot, ".tmp", "jest-sim-cli"),
  );
  assert.deepEqual(config.configs[0].testMatch, ["**/src/testing/SimCli.tsx"]);
});

test("the CLI returns failure, finishes other selected gates, and prints an exact partial retry", (t) => {
  const parent = path.resolve(".tmp", "check-cli-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "run-"));
  t.after(() => {
    assert(root.startsWith(parent + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        lint: 'node -e "process.exit(1)"',
        "format:check": 'node -e "process.exit(0)"',
      },
    }),
  );
  for (const prefix of [[], ["--ci"]]) {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/check.js"),
        ...prefix,
        "--steps",
        "lint,formatting",
      ],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ok\s+Formatting/);
    assert.match(result.stderr, /Failed 1\/2 gates/);
    assert.match(result.stderr, /Partial check only/);
    assert.match(
      result.stderr,
      /Also rerun any passing gates whose inputs changed/,
    );
    assert.match(result.stderr, /rerun: npm run check -- --steps lint\s*$/);
    assert.doesNotMatch(result.stderr, /Starting (Types|Production)/);
  }
});

test("successful CLI gates retain their output and explicit validation scope", (t) => {
  const parent = path.resolve(".tmp", "check-cli-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        "format:check": 'node -e "console.log(123);console.error(456)"',
      },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/check.js"), "--steps", "formatting"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const match = /Validation report: (.+report\.json)/.exec(result.stderr);
  assert(match, "even successful commands must leave a reviewable report");
  const report = JSON.parse(fs.readFileSync(match[1], "utf8"));
  assert.equal(report.status, "passed");
  assert.equal(report.scope.full, false);
  assert.deepEqual(report.scope.selected, ["formatting"]);
  assert(report.scope.notSelected.includes("tests"));
  assert(report.scope.ciOnly.includes("packaged-electron"));
  assert.equal(report.environment.node, process.version);
  assert.equal(report.environment.platform, process.platform);
  assert.equal(report.gates[0].status, "passed");
  assert.equal(report.gates[0].exitCode, 0);
  assert.deepEqual(report.gates[0].command, [
    "npm",
    "run",
    "--silent",
    "format:check",
  ]);
  const output = fs.readFileSync(
    path.resolve(path.dirname(match[1]), report.gates[0].log),
    "utf8",
  );
  assert.match(output, /123/);
  assert.match(output, /456/);
});

for (const file of ["source.txt", "untracked.txt"]) {
  test(`a CLI run invalidates passing gates after ${file} changes`, (t) => {
    const parent = path.resolve(".tmp", "check-cli-tests");
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, "changed-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true,
      });
    git("init", "--quiet");
    fs.writeFileSync(path.join(root, ".gitignore"), ".tmp/\n");
    fs.writeFileSync(path.join(root, "source.txt"), "before");
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "format:check": "node mutate.cjs",
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, "mutate.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(file)}, 'after');\n`,
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Check fixture",
      "-c",
      "user.email=check@example.test",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    const commit = git("rev-parse", "HEAD").trim();
    if (file === "untracked.txt")
      fs.writeFileSync(path.join(root, file), "before");
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/check.js"), "--steps", "formatting"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    assert.equal(
      result.status,
      1,
      "a passing gate cannot validate a changing source tree",
    );
    const match = /Validation report: (.+report\.json)/.exec(result.stderr);
    assert(match, result.stderr);
    const report = JSON.parse(fs.readFileSync(match[1], "utf8"));
    assert.equal(report.source.before.commit, commit);
    assert.equal(report.source.before.dirty, file === "untracked.txt");
    assert.equal(report.source.after.dirty, true);
    assert.equal(report.source.changedDuringRun, true);
    assert.equal(report.status, "invalidated");
    assert.equal(
      report.gates[0].status,
      "passed",
      "the source guard, not the command, caused failure",
    );
    assert.match(result.stderr, /Source changed during validation/);
  });
}

test("browser gates retain attempt reports and reject missing output instead of borrowing a stale pass", (t) => {
  const parent = path.resolve(".tmp", "check-cli-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "browser evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        build: 'node -e "process.exit(0)"',
        "test:e2e:ci": "node browser.cjs",
      },
    }),
  );
  const browser = path.join(root, "browser.cjs");
  fs.writeFileSync(
    browser,
    `const fs = require('node:fs');
    const directory = process.env.ELECTRIFY_E2E_OUTPUT_DIR;
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(require('node:path').join(directory, 'results.json'), JSON.stringify({stats: {expected: 1}, suites: []}));`,
  );
  const invoke = () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/check.js"), "--steps", "browser"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    const match = /Validation report: (.+report\.json)/.exec(result.stderr);
    assert(match, result.stderr);
    return {
      result,
      report: JSON.parse(fs.readFileSync(match[1], "utf8")),
      directory: path.dirname(match[1]),
    };
  };
  const passing = invoke();
  assert.equal(passing.result.status, 0, passing.result.stderr);
  const gate = passing.report.gates.find(({ id }) => id === "browser");
  assert.deepEqual(gate.reports, [path.join("browser", "results.json")]);
  assert.equal(
    JSON.parse(
      fs.readFileSync(path.join(passing.directory, gate.reports[0]), "utf8"),
    ).stats.expected,
    1,
  );
  fs.writeFileSync(
    browser,
    "// A command that exits zero without emitting the required report.\n",
  );
  const missing = invoke();
  assert.equal(missing.result.status, 1);
  const failed = missing.report.gates.find(({ id }) => id === "browser");
  assert.equal(failed.exitCode, 0);
  assert.equal(failed.status, "failed");
  assert.match(failed.reportErrors[0], /Required report.*missing or invalid/);
  assert.equal(
    passing.report.status,
    "passed",
    "the earlier invocation remains independently reviewable",
  );
  assert(fs.existsSync(path.join(passing.directory, gate.reports[0])));
});
