const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const { steps } = require("../check");

const gateIds = [
  "types",
  "lint",
  "formatting",
  "desktop",
  "tooling",
  "tests",
  "simulations",
  "sim",
  "bench",
  "build",
  "bundle",
  "browser",
  "desktop-build",
  "multiplayer",
  "steam-input",
];

// Exercise the real CLI, npm dispatch, reports and cache against cheap processes.
// Every stub records execution independently of the runner's reuse metadata.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-resume-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
    });
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Validation fixture",
      "-c",
      "user.email=validation@example.test",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
  };
  git("init", "--quiet");
  write(".gitignore", ".tmp/\nnode_modules/\nbuild/\n.env*.local\n");
  write("src/app.ts", "export const value = 1;\n");
  write("src/example.test.tsx", "// covered unit fixture\n");
  write("src/testing/example.sim.test.tsx", "// simulation fixture\n");
  write("e2e/example.spec.ts", "// browser fixture\n");
  write("public/index.html", "<!doctype html><title>Fixture</title>\n");
  write("package-lock.json", { lockfileVersion: 3, packages: {} });
  write(".tmp/control.json", {});
  write("package.json", {
    name: "validation-fixture",
    scripts: Object.fromEntries(
      steps.map(({ id, script }) => [script, `node gate.cjs ${id}`]),
    ),
  });
  write(
    "gate.cjs",
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const id = process.argv[2];
    const control = JSON.parse(fs.readFileSync('.tmp/control.json', 'utf8'));
    fs.appendFileSync('.tmp/executed.jsonl', JSON.stringify({id, args: process.argv.slice(3)}) + '\\n');
    console.log('Executed fixture gate: ' + id);
    if (control.mutate === id) fs.appendFileSync('src/app.ts', '// changed during validation\\n');
    if (control.mutateEnv === id) fs.writeFileSync('.env.production.local', 'REACT_APP_FIXTURE=changed\\n');
    if ((control.fail || []).includes(id)) process.exit(1);
    if (id === 'build' || id === 'desktop-build') {
      const output = process.env.BUILD_PATH || 'build';
      const counter = '.tmp/' + id + '-count';
      const generation = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
      fs.writeFileSync(counter, String(generation));
      fs.mkdirSync(output, {recursive: true});
      fs.writeFileSync(path.join(output, 'index.html'), id + ':' + generation);
    }
    if (process.env.ELECTRIFY_E2E_OUTPUT_DIR) {
      fs.mkdirSync(process.env.ELECTRIFY_E2E_OUTPUT_DIR, {recursive: true});
      fs.writeFileSync(path.join(process.env.ELECTRIFY_E2E_OUTPUT_DIR, 'results.json'), JSON.stringify({
        stats: {expected: 1, skipped: 0, unexpected: 0, flaky: 0},
        suites: [{title: 'fixture', specs: [{title: id, tests: [{results: [{status: 'passed', retry: 0}]}]}]}]
      }));
    }
  `,
  );
  commit();
  const run = (args, env = {}) => {
    write(".tmp/executed.jsonl", "");
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../check.js"), ...args],
      {
        cwd: root,
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          ELECTRIFY_CHECK_WORKERS: "2",
          ...env,
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const match = /Validation report: (.+report\.json)/.exec(result.stderr);
    assert(match, result.stderr || result.error?.message);
    const reportPath = match[1].trim();
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const executed = fs
      .readFileSync(path.join(root, ".tmp/executed.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).id)
      .sort();
    return { result, report, reportPath, executed };
  };
  return { root, write, run, commit };
}

function passes(run) {
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.report.status, "passed");
  assert(run.report.gates.every(({ status }) => status === "passed"));
}

function executedExactly(run, expected) {
  assert.deepEqual(run.executed, [...expected].sort(), run.result.stderr);
  assert.deepEqual(
    run.report.gates
      .filter(({ execution }) => execution === "executed")
      .map(({ id }) => id)
      .sort(),
    [...expected].sort(),
  );
}

test("a full resumed check accounts for all fifteen gates without executing unchanged work", (t) => {
  assert.deepEqual(
    steps.map(({ id }) => id),
    gateIds,
  );
  const { run, write, commit } = fixture(t);
  const initial = run(["--ci"]);
  passes(initial);
  executedExactly(initial, gateIds);
  const resumed = run(["--ci", "--resume"]);
  passes(resumed);
  executedExactly(resumed, []);
  assert.equal(resumed.report.scope.full, true);
  assert.equal(resumed.report.scope.profile, "ci");
  assert.deepEqual(
    resumed.report.gates.map(({ id }) => id),
    gateIds,
  );
  for (const gate of resumed.report.gates) {
    assert.equal(gate.execution, "reused");
    assert.equal(gate.reusedFrom.gate, gate.id);
    assert(gate.reusedFrom.report);
  }
  write("src/example.test.tsx", "// changed covered assertion\n");
  const changed = run(["--ci", "--resume"]);
  passes(changed);
  executedExactly(changed, [
    "types",
    "lint",
    "formatting",
    "desktop",
    "tooling",
    "tests",
  ]);
  commit();
  const committed = run(["--ci", "--resume"]);
  passes(committed);
  executedExactly(committed, []);
});

test("a failed gate reruns while valid passes from the same completed run are reused", (t) => {
  const { run, write } = fixture(t);
  write(".tmp/control.json", { fail: ["lint"] });
  const first = run(["--steps", "lint,formatting"]);
  assert.equal(first.result.status, 1, first.result.stderr);
  assert.equal(first.report.status, "failed");
  executedExactly(first, ["lint", "formatting"]);
  write(".tmp/control.json", {});
  const repaired = run(["--resume", "--steps", "lint,formatting"]);
  passes(repaired);
  executedExactly(repaired, ["lint"]);
  assert.equal(repaired.report.scope.full, false);
});

test("passing gates from a source-invalidated run cannot be resumed", (t) => {
  const { run, write } = fixture(t);
  write(".tmp/control.json", { mutate: "lint" });
  const changing = run(["--steps", "lint,formatting"]);
  assert.equal(changing.result.status, 1, changing.result.stderr);
  assert.equal(changing.report.status, "invalidated");
  write(".tmp/control.json", {});
  const stable = run(["--resume", "--steps", "lint,formatting"]);
  passes(stable);
  executedExactly(stable, ["lint", "formatting"]);
});

test("an ignored environment change during validation invalidates the report", (t) => {
  const { run, write } = fixture(t);
  write(".tmp/control.json", { mutateEnv: "lint" });
  const changing = run(["--steps", "lint,formatting"]);
  assert.equal(changing.result.status, 1, changing.result.stderr);
  assert.equal(changing.report.status, "invalidated");
  write(".tmp/control.json", {});
  const stable = run(["--resume", "--steps", "lint,formatting"]);
  passes(stable);
  executedExactly(stable, ["lint", "formatting"]);
});

test("missing evidence and unfinished reports cannot supply a reused pass", (t) => {
  const { run } = fixture(t);
  const first = run(["--steps", "lint"]);
  passes(first);
  fs.rmSync(
    path.join(path.dirname(first.reportPath), first.report.gates[0].log),
  );
  const missing = run(["--resume", "--steps", "lint"]);
  passes(missing);
  executedExactly(missing, ["lint"]);
  const interrupted = { ...missing.report, status: "running" };
  delete interrupted.finishedAt;
  fs.writeFileSync(missing.reportPath, JSON.stringify(interrupted));
  const incomplete = run(["--resume", "--steps", "lint"]);
  passes(incomplete);
  executedExactly(incomplete, ["lint"]);
});

test("browser edits reuse both renderers; corrupt web output rebuilds without replacing desktop output", (t) => {
  const { root, run, write } = fixture(t);
  const selection = ["--steps", "browser,steam-input"];
  const initial = run(selection);
  passes(initial);
  executedExactly(initial, [
    "build",
    "browser",
    "desktop-build",
    "steam-input",
  ]);
  const web = path.join(root, ".tmp/check-builds/web/index.html");
  const desktop = path.join(root, ".tmp/check-builds/desktop/index.html");
  const webBefore = fs.readFileSync(web, "utf8");
  const desktopBefore = fs.readFileSync(desktop, "utf8");
  assert.notEqual(webBefore, desktopBefore);
  write("e2e/example.spec.ts", "// changed browser assertion\n");
  const changed = run(["--resume", ...selection]);
  passes(changed);
  executedExactly(changed, ["browser", "steam-input"]);
  assert.equal(fs.readFileSync(web, "utf8"), webBefore);
  assert.equal(fs.readFileSync(desktop, "utf8"), desktopBefore);
  fs.writeFileSync(web, "corrupted artifact");
  const rebuilt = run(["--resume", ...selection]);
  passes(rebuilt);
  executedExactly(rebuilt, ["build", "browser"]);
  assert.equal(fs.readFileSync(desktop, "utf8"), desktopBefore);
});

test("malformed browser evidence reruns the browser while preserving its verified build", (t) => {
  const { run } = fixture(t);
  const first = run(["--steps", "browser"]);
  passes(first);
  const browser = first.report.gates.find(({ id }) => id === "browser");
  fs.writeFileSync(
    path.join(path.dirname(first.reportPath), browser.reports[0]),
    "{malformed report",
  );
  const repaired = run(["--resume", "--steps", "browser"]);
  passes(repaired);
  executedExactly(repaired, ["browser"]);
});

test("unknown inputs, ignored environment files and effective gate arguments invalidate reuse", (t) => {
  const { run, write } = fixture(t);
  const selection = ["--steps", "tests,simulations"];
  passes(run(selection));
  write("new-input.txt", "unknown input\n");
  const unknown = run(["--resume", ...selection]);
  passes(unknown);
  executedExactly(unknown, ["tests", "simulations"]);
  write(".env.production.local", "REACT_APP_FIXTURE=changed\n");
  const environment = run(["--resume", ...selection]);
  passes(environment);
  executedExactly(environment, ["tests", "simulations"]);
  const workers = run(["--resume", ...selection], {
    ELECTRIFY_CHECK_WORKERS: "1",
  });
  passes(workers);
  executedExactly(workers, ["tests", "simulations"]);
});

test("hosted CI always executes its gates even when resume is requested", (t) => {
  const { run } = fixture(t);
  const args = ["--steps", "lint,formatting"];
  const env = { GITHUB_ACTIONS: "true" };
  passes(run(args, env));
  const second = run(["--resume", ...args], env);
  passes(second);
  executedExactly(second, ["lint", "formatting"]);
});
