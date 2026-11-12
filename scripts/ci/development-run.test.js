const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { alive, acquireLease, readOwner } = require("../dev/coordination");
const { claimTask } = require("../dev/task");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-run-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  execFileSync("git", ["init", "--quiet"], {
    cwd: root,
    stdio: "pipe",
    windowsHide: true,
  });
  write("package.json", { name: "fixture" });
  write("package-lock.json", {
    lockfileVersion: 3,
    packages: { "": { name: "fixture" } },
  });
  write("node_modules/.package-lock.json", {
    lockfileVersion: 3,
    packages: {},
  });
  write(
    "scripts/run-compatibility.js",
    "require('node:fs').appendFileSync('generators.log','compatibility\\n')",
  );
  write(
    "scripts/generate-icon-manifest.js",
    "require('node:fs').appendFileSync('generators.log','icons\\n')",
  );
  write(
    "runner.cjs",
    `
    process.on('message',message=>{if(message==='cancel')process.emit('SIGTERM')});
    require(${JSON.stringify(require.resolve("../dev/run"))}).runCommand(process.argv[2],process.argv.slice(3),
      {root:process.cwd(),coordinationRoot:require('node:path').join(process.cwd(),'locks')})
      .then(code=>{process.exitCode=code;if(process.connected)process.disconnect()})
      .catch(error=>{console.error(error.message);process.exitCode=1;if(process.connected)process.disconnect()});
  `,
  );
  const env = {
    ...process.env,
    GITHUB_ACTIONS: "false",
    ELECTRIFY_TASK_ID: "fixture",
    ELECTRIFY_DEVELOPMENT_LEASE: "",
    ELECTRIFY_DEVELOPMENT_GROUP: "",
    npm_config_ignore_scripts: "false",
  };
  const run = (mode, args = [], extra = {}) =>
    spawnSync(process.execPath, ["runner.cjs", mode, ...args], {
      cwd: root,
      env: { ...env, ...extra },
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
  return { root, write, env, run };
}

test("wrapper runs generators inside coordination, forwards literal arguments and preserves failure", (t) => {
  const { root, write, run } = fixture(t);
  write(
    "scripts/build.js",
    "require('node:fs').writeFileSync('argv.json',JSON.stringify(process.argv.slice(2)));process.exitCode=7",
  );
  const args = ["space inside", "dollar$literal", "semi;literal"];
  const result = run("build", args);
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "argv.json"))),
    args,
  );
  assert.equal(
    fs.readFileSync(path.join(root, "generators.log"), "utf8"),
    "compatibility\nicons\n",
  );
  assert(!fs.existsSync(path.join(root, "locks/heavy")));
});

test("hosted trimmed installations preserve ignore-scripts and bypass only local coordination", (t) => {
  const { root, write, run } = fixture(t);
  fs.rmSync(path.join(root, "node_modules"), { recursive: true });
  write("scripts/build.js", "process.exitCode=9");
  const result = run("build", [], {
    GITHUB_ACTIONS: "true",
    npm_config_ignore_scripts: "true",
  });
  assert.equal(result.status, 9, result.stderr);
  assert(!fs.existsSync(path.join(root, "generators.log")));
  assert(!fs.existsSync(path.join(root, "locks")));
});

test("the CI test wrapper invokes the renamed harness and forwards CPU-only mode", (t) => {
  const { root, write, run } = fixture(t);
  write(
    "scripts/ci/test-suites.js",
    "require('node:fs').writeFileSync('ci-args.json', JSON.stringify(process.argv.slice(2)))",
  );
  const result = run("ci-tests", ["--cpu-only"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "ci-args.json"))),
    ["--cpu-only"],
  );
});

test("bad dependency installations fail before generators or work execute", (t) => {
  const { root, write, run } = fixture(t);
  fs.rmSync(path.join(root, "node_modules/.package-lock.json"));
  write("scripts/build.js", "require('node:fs').writeFileSync('ran','bad')");
  const result = run("build");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency preflight failed/);
  assert(!fs.existsSync(path.join(root, "generators.log")));
  assert(!fs.existsSync(path.join(root, "ran")));
});

test("the public status command bypasses occupied claims, reservations, installation, assets and generators", async (t) => {
  const { root, write, env } = fixture(t);
  const reportPath = path.join(
    root,
    ".tmp/check-runs/2020-01-01T00-00-00-000-fixture/report.json",
  );
  write(path.relative(root, reportPath), {
    schemaVersion: 1,
    status: "passed",
    startedAt: "2020-01-01T00:00:00.000Z",
    finishedAt: "2020-01-01T00:00:01.000Z",
    source: { changedDuringRun: false },
    scope: { profile: "quick", full: false, selected: ["formatting"] },
    gates: [
      {
        id: "formatting",
        status: "passed",
        exitCode: 0,
        execution: "executed",
      },
    ],
  });
  write("package.json", { scripts: { check: "node runner.cjs check" } });
  write(
    "scripts/check.js",
    `
    const result = require('node:child_process').spawnSync(process.execPath,
      [${JSON.stringify(path.resolve(__dirname, "../check.js"))}, ...process.argv.slice(2)], {stdio:'inherit'});
    process.exitCode = result.status ?? 1;
  `,
  );
  fs.rmSync(path.join(root, "node_modules"), { recursive: true });
  write("public/missing.png", "version https://git-lfs.github.com/spec/v1\n");
  execFileSync("git", ["add", "public/missing.png"], {
    cwd: root,
    stdio: "pipe",
    windowsHide: true,
  });
  const owner = claimTask(root, "another-task");
  const leases = [];
  t.after(() => leases.forEach((lease) => lease.release()));
  for (let index = 0; index < 3; index++)
    leases.push(
      await acquireLease("heavy", {
        root: path.join(root, "locks"),
        slots: 3,
        wait: false,
      }),
    );
  const invoke = (args) =>
    spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "--silent", "check", "--", ...args],
      {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        shell: process.platform === "win32",
      },
    );
  for (const args of [
    ["--status", "--json"],
    ["--status", reportPath, "--json"],
    ["--help"],
  ]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    if (args.includes("--json")) {
      const status = JSON.parse(result.stdout);
      assert.equal(status.recordedStatus, "passed");
      assert.equal(status.currentValidation, "not-checked");
    }
    assert.doesNotMatch(
      result.stderr,
      /Waiting for validation|Validation slot acquired|preflight|Starting/,
    );
  }
  assert.equal(
    readOwner(path.join(root, ".tmp/development-task")).token,
    owner.token,
  );
  for (const [index, lease] of leases.entries())
    assert.equal(
      readOwner(
        path.join(root, index ? `locks/heavy-${index + 1}` : "locks/heavy"),
      ).token,
      lease.token,
    );
  assert(!fs.existsSync(path.join(root, "generators.log")));
});

test("mixed check diagnostics are rejected before bypass or executable work, while normal checks retain setup", (t) => {
  const { root, write, run } = fixture(t);
  write(
    "scripts/check.js",
    "require('node:fs').writeFileSync('entered-check','bad')",
  );
  fs.rmSync(path.join(root, "node_modules"), { recursive: true });
  for (const args of [
    ["--status", "--steps", "lint"],
    ["--steps", "lint", "--status"],
    ["--ci", "--status"],
    ["--status", "--resume"],
    ["--status", "--help"],
    ["--status", "--json", "--json"],
    ["--status", "one.json", "two.json"],
    ["--report", "report.json", "--steps", "lint"],
    ...[
      "--ci",
      "--resume",
      "--steps",
      "--help",
      "--report",
      "--status",
      "--json",
    ].map((option) => ["--report", option]),
    ["--steps", "lint", "--help"],
  ]) {
    const result = run("check", args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /Usage: npm run check/);
    assert(!fs.existsSync(path.join(root, "entered-check")));
    assert(!fs.existsSync(path.join(root, "generators.log")));
    assert(!fs.existsSync(path.join(root, ".tmp/development-task")));
    assert(!fs.existsSync(path.join(root, "locks")));
  }
  const executable = run("check", ["--steps", "lint"]);
  assert.equal(executable.status, 1);
  assert.match(executable.stderr, /Dependency preflight failed/);
  assert(!fs.existsSync(path.join(root, "entered-check")));
});

test("conflicting start ports fail before preparing or starting the server", (t) => {
  const { root, write, run } = fixture(t);
  write("scripts/start.js", "require('node:fs').writeFileSync('ran','bad')");
  const result = run("start", [], { PORT: "3101", E2E_PORT: "3102" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT.*E2E_PORT|E2E_PORT.*PORT/);
  assert(!fs.existsSync(path.join(root, "generators.log")));
  assert(!fs.existsSync(path.join(root, "ran")));
});

test("nested wrappers complete inside the parent's lease", (t) => {
  const { root, write, run } = fixture(t);
  write(
    "scripts/check.js",
    `
    const {spawnSync}=require('node:child_process');
    const result=spawnSync(process.execPath,['runner.cjs','bench'],{env:process.env,stdio:'inherit'});
    process.exitCode=result.status;
  `,
  );
  write(
    "scripts/perf/bench.js",
    "require('node:fs').writeFileSync('nested-ran','yes')",
  );
  // The nested fixture runner must retain, rather than replace, inherited env.
  const result = run("check");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, "nested-ran"), "utf8"), "yes");
  assert.equal(
    (result.stderr.match(/Validation slot acquired/g) || []).length,
    1,
  );
});

test("cancelling nested work stops its descendants before releasing the validation slot", async (t) => {
  const { root, write, env } = fixture(t);
  write(
    "scripts/check.js",
    `
    const child=require('node:child_process').spawn(process.execPath,['runner.cjs','bench'],{env:process.env,stdio:'inherit'});
    child.on('exit',code=>process.exitCode=code);
  `,
  );
  write(
    "scripts/perf/bench.js",
    `
    require('node:fs').writeFileSync('leaf.pid',String(process.pid));
    process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),1200));
    process.stdout.write('leaf-ready\\n');
    setInterval(()=>{},100);
  `,
  );
  const child = spawn(process.execPath, ["runner.cjs", "check"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 10000;
  while (!output.includes("leaf-ready") && Date.now() < deadline)
    await delay(20);
  assert.match(output, /leaf-ready/);
  const leaf = Number(fs.readFileSync(path.join(root, "leaf.pid"), "utf8"));
  const exited = once(child, "close");
  // Windows kill(SIGTERM) force-terminates Node rather than delivering its JS
  // handler. Exercise that handler through IPC there; POSIX uses the real signal.
  if (process.platform === "win32") child.send("cancel");
  else child.kill("SIGTERM");
  await exited;
  assert.equal(
    alive(leaf),
    false,
    "the leaf cannot outlive the released reservation",
  );
  assert(!fs.existsSync(path.join(root, "locks/heavy")));
});

test("abrupt supervisor death keeps the slot reserved while its command is alive", async (t) => {
  const { root, write, env } = fixture(t);
  write(
    "scripts/perf/bench.js",
    "process.stdout.write('leaf-ready\\n');setInterval(()=>{},100)",
  );
  const supervisor = spawn(process.execPath, ["runner.cjs", "bench"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let owner = null;
  t.after(async () => {
    if (process.platform === "win32" && owner?.childPid)
      spawnSync("taskkill", ["/pid", String(owner.childPid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else if (owner?.groupId) {
      try {
        process.kill(-owner.groupId, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (supervisor.exitCode === null && supervisor.signalCode === null)
      supervisor.kill("SIGKILL");
  });
  let output = "";
  supervisor.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const deadline = Date.now() + 10000;
  while (!output.includes("leaf-ready") && Date.now() < deadline)
    await delay(20);
  assert.match(output, /leaf-ready/);
  owner = readOwner(path.join(root, "locks/heavy"));
  assert(owner?.childPid);
  const exited = once(supervisor, "exit");
  supervisor.kill("SIGKILL");
  await exited;
  assert(alive(owner.childPid));
  await assert.rejects(
    acquireLease("heavy", { root: path.join(root, "locks"), wait: false }),
    /held by PID/,
  );
  assert.equal(readOwner(path.join(root, "locks/heavy")).token, owner.token);
});
