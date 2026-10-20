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
    selectSteps(["--steps", "browser,multiplayer"]),
    async (step) => {
      visited.push(step.id);
      return { ...step, ok: step.id !== "build" };
    },
  );
  assert.deepEqual(visited, ["build", "desktop-build", "multiplayer"]);
  assert.equal(results.find((result) => result.id === "browser").ok, false);
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

test("the simulation CLI uses an in-process Jest run and a worktree-local cache", () => {
  // Ask the CLI's actual Jest invocation for its resolved config, without running a simulation.
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `const cp = require('node:child_process');
       const spawn = cp.spawnSync;
       cp.spawnSync = (command, args, options) => {
         const result = spawn(command, [...args, '--showConfig'], {
           ...options, stdio: 'pipe', encoding: 'utf8'
         });
         process.stdout.write(result.stdout || '');
         process.stderr.write(result.stderr || '');
         return result;
       };
       require('./scripts/sim');`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.globalConfig.maxWorkers, 1);
  assert.equal(
    path.resolve(config.configs[0].cacheDirectory),
    path.resolve(".tmp/jest-sim-cli"),
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
