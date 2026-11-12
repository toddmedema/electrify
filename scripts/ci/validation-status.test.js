const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { steps } = require("../check");

const cli = path.resolve(__dirname, "../check.js");
function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "electrify-status-test-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    return target;
  };
  const run = (args, preload, env = {}) =>
    spawnSync(
      process.execPath,
      [...(preload ? ["--require", preload] : []), cli, ...args],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        env: { ...process.env, GITHUB_ACTIONS: "false", ...env },
      },
    );
  const inspect = (args = [], preload) => {
    const result = run(["--status", ...args, "--json"], preload);
    return { result, status: JSON.parse(result.stdout) };
  };
  return { root, write, run, inspect };
}

function report(selected = steps) {
  const source = {
    commit: "recorded-commit",
    fingerprint: "recorded-bytes",
    dirty: false,
  };
  return {
    schemaVersion: 1,
    status: "passed",
    startedAt: "2020-01-01T00:00:00.000Z",
    finishedAt: "2020-01-01T00:00:01.000Z",
    source: { before: source, after: source, changedDuringRun: false },
    environment: {
      node: "v26.13.0",
      platform: "linux",
      arch: "x64",
      jestWorkers: 4,
    },
    scope: {
      profile: selected.some((step) => step.ci) ? "ci" : "quick",
      full: steps
        .filter((step) => selected.some((entry) => entry.ci) || !step.ci)
        .every((step) => selected.includes(step)),
      selected: selected.map(({ id }) => id),
      ciOnly: ["packaged-electron"],
      separateChecks: ["firestore-rules"],
    },
    timing: { queueMs: 250, executionMs: 1000 },
    gates: selected.map(({ id }) => ({
      id,
      status: "passed",
      execution: "executed",
      log: `${id}.log`,
      exitCode: 0,
    })),
  };
}
const older = ".tmp/check-runs/2020-01-01T00-00-00-000-old/report.json";
const newest = ".tmp/check-runs/2020-01-02T00-00-00-000-new/report.json";

test("report operands reject reserved options while retaining leading-dash filenames", (t) => {
  const { write, run } = fixture(t);
  for (const operand of [
    "--resume",
    "--ci",
    "--steps",
    "--help",
    "--report",
    "--status",
    "--json",
  ]) {
    write(operand, report());
    const rejected = run(["--report", operand]);
    assert.equal(rejected.status, 1, operand);
    assert.match(rejected.stderr, /Usage: npm run check/);
    assert.equal(rejected.stdout, "");
    const explicit = run(["--report", `./${operand}`]);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stdout, /Local validation: passed/);
  }
  for (const operand of ["-", "-report.json", "--report.json"]) {
    write(operand, report());
    const accepted = run(["--report", operand]);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /Local validation: passed/);
  }
});

test("passing gates require execution evidence in the newest report and preserve accurate counts", (t) => {
  const { root, write, inspect } = fixture(t);
  write(older, report());
  for (const execution of [undefined, null]) {
    const incomplete = report();
    for (const gate of incomplete.gates) {
      if (execution === undefined) delete gate.execution;
      else gate.execution = execution;
    }
    write(newest, incomplete);
    const { result, status } = inspect();
    assert.equal(result.status, 1);
    assert.equal(status.availability, "unavailable");
    assert.equal(status.reportPath, path.join(root, newest));
    assert.match(status.reason, /Incomplete or unsupported validation report/);
    assert.equal(status.recordedStatus, undefined);
  }
  const valid = report();
  write(newest, valid);
  let { status } = inspect();
  assert.equal(status.recordedStatus, "passed");
  assert.equal(status.counts.executed, steps.length);
  assert.equal(status.counts.reused, 0);
  valid.gates[0].execution = "reused";
  write(newest, valid);
  status = inspect().status;
  assert.equal(status.recordedStatus, "passed");
  assert.equal(status.counts.executed, steps.length - 1);
  assert.equal(status.counts.reused, 1);

  valid.status = "failed";
  Object.assign(valid.gates[0], {
    status: "failed",
    execution: "executed",
    exitCode: 1,
  });
  Object.assign(valid.gates[1], { status: "skipped", exitCode: undefined });
  delete valid.gates[1].execution;
  write(newest, valid);
  status = inspect().status;
  assert.equal(status.recordedStatus, "failed");
  assert.equal(status.counts.failed, 1);
  assert.equal(status.counts.skipped, 1);
  assert.equal(status.counts.executed, steps.length - 1);
  assert.equal(status.counts.reused, 0);
});

test("status discovers only the newest recorded run and preserves historical provenance and safe retries", (t) => {
  const { root, write, inspect, run } = fixture(t);
  write(older, report());
  const current = report();
  current.status = "failed";
  Object.assign(
    current.gates.find(({ id }) => id === "lint"),
    {
      status: "failed",
      exitCode: 1,
      reason: "fixture failure",
      command: ["echo", "unsafe;command"],
    },
  );
  Object.assign(
    current.gates.find(({ id }) => id === "browser"),
    {
      execution: "reused",
      reports: ["browser/results.json"],
      reusedFrom: { report: older, gate: "browser" },
    },
  );
  const target = write(newest, current);
  write(path.join(path.dirname(newest), "lint.log"), "failure detail");
  write(path.join(path.dirname(newest), "browser/results.json"), { stats: {} });
  const { result, status } = inspect();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(status.reportPath, target);
  assert.equal(status.recordedStatus, "failed");
  assert.equal(status.historical, true);
  assert.equal(status.completed, true);
  assert.equal(status.currentValidation, "not-checked");
  assert.equal(status.reuseEligibility, "not-checked");
  assert.deepEqual(status.activity, {
    queued: "unknown",
    ownerAlive: "unknown",
  });
  assert.equal(status.counts.total, steps.length);
  assert.equal(status.counts.failed, 1);
  assert.equal(status.counts.executed, steps.length - 1);
  assert.equal(status.counts.reused, 1);
  assert.deepEqual(status.provenance.source, current.source);
  assert.deepEqual(status.provenance.environment, current.environment);
  assert.equal(status.provenance.evidenceContents, "not-checked");
  assert.equal(status.timing.queueMs, 250);
  assert.equal(status.timing.elapsedMs, 1000);
  assert(status.timing.ageMs > 1000, "old evidence remains visibly historical");
  assert.equal(
    status.gates.find(({ id }) => id === "lint").log.available,
    true,
  );
  assert.equal(
    status.gates.find(({ id }) => id === "types").log.available,
    false,
  );
  const browser = status.gates.find(({ id }) => id === "browser");
  assert.equal(browser.reports[0].available, true);
  assert.deepEqual(browser.reusedFrom, { report: older, gate: "browser" });
  assert.equal(status.rerun.failed, "npm run check -- --steps lint");
  assert.equal(status.rerun.integrated, "npm run check:ci -- --resume");
  assert(!JSON.stringify(status.rerun).includes("unsafe"));
  const text = run(["--status"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Historical validation/);
  assert.match(text.stdout, /Failed-gate retry: npm run check -- --steps lint/);
  assert.match(text.stdout, /lint\.log/);
  const explicit = inspect([path.join(root, older)]).status;
  assert.equal(explicit.recordedStatus, "passed");
  assert.equal(explicit.historical, true);
  assert.equal(explicit.currentValidation, "not-checked");
});

test("missing, malformed and empty newest runs cannot fall back to an older pass", (t) => {
  const { root, write, inspect } = fixture(t);
  let inspected = inspect();
  assert.equal(inspected.result.status, 1);
  assert.equal(inspected.status.availability, "unavailable");
  write(older, report());
  fs.mkdirSync(path.join(root, path.dirname(newest)), { recursive: true });
  for (const value of [
    null,
    '{"schemaVersion":1,',
    "null",
    "{}",
    { ...report(), schemaVersion: 99 },
  ]) {
    if (value !== null) write(newest, value);
    inspected = inspect();
    assert.equal(inspected.result.status, 1, JSON.stringify(value));
    assert.equal(inspected.status.availability, "unavailable");
    assert.equal(inspected.status.reportPath, path.join(root, newest));
    assert.equal(inspected.status.recordedStatus, undefined);
  }
  write(newest, " ".repeat(1024 * 1024 + 1));
  assert.equal(inspect().status.availability, "unavailable");
  assert.equal(inspect(["missing.json"]).status.availability, "unavailable");
});

test("inconsistent completed reports are unavailable; partial and abandoned runs never claim full CI coverage", (t) => {
  const { write, inspect } = fixture(t);
  for (const mutate of [
    (value) => {
      delete value.finishedAt;
    },
    (value) => {
      value.gates.pop();
    },
    (value) => {
      value.gates[0].status = "running";
    },
    (value) => {
      value.gates[0].status = "failed";
    },
    (value) => {
      value.gates[0].exitCode = 1;
    },
    (value) => {
      value.gates[0].id = value.gates[1].id;
    },
    (value) => {
      value.scope.selected[0] = "lint;echo injected";
    },
    (value) => {
      value.scope.ciOnly = "bad";
    },
    (value) => {
      value.scope.separateChecks = {};
    },
    (value) => {
      value.source.changedDuringRun = true;
    },
  ]) {
    const value = report();
    mutate(value);
    write(newest, value);
    const { result, status } = inspect();
    assert.equal(result.status, 1);
    assert.equal(status.availability, "unavailable");
  }
  const partial = report(
    steps.filter(({ id }) => ["lint", "formatting"].includes(id)),
  );
  write(newest, partial);
  let { status } = inspect();
  assert.equal(status.recordedStatus, "passed");
  assert.equal(status.scope.full, false);
  assert.equal(status.counts.total, 2);
  assert(status.scope.notSelected.includes("tests"));
  partial.scope.full = true;
  write(newest, partial);
  assert.equal(inspect().status.availability, "unavailable");
  const abandoned = report();
  abandoned.status = "running";
  delete abandoned.finishedAt;
  abandoned.source.after = null;
  abandoned.gates[0].status = "running";
  abandoned.gates[1].status = "pending";
  delete abandoned.gates[0].execution;
  delete abandoned.gates[1].execution;
  write(newest, abandoned);
  status = inspect().status;
  assert.equal(status.recordedStatus, "running");
  assert.equal(status.completed, false);
  assert.equal(status.counts.running, 1);
  assert.equal(status.counts.pending, 1);
  assert.equal(status.counts.executed, steps.length - 2);
  assert.equal(status.activity.ownerAlive, "unknown");
});

test("status never executes report commands or reads external evidence paths", (t) => {
  const { root, write, inspect } = fixture(t);
  const value = report();
  value.gates[0].log = "../../outside.log";
  value.gates[1].log = "C:\\external\\log.txt";
  value.gates[2].reports = ["/etc/passwd"];
  value.command = [
    "node",
    "-e",
    "require('node:fs').writeFileSync('executed','bad')",
  ];
  const target = write(newest, value);
  const before = fs.readFileSync(target, "utf8");
  const { status } = inspect();
  assert.deepEqual(status.gates[0].log, { path: null, available: false });
  assert.deepEqual(status.gates[1].log, { path: null, available: false });
  assert.deepEqual(status.gates[2].reports[0], {
    path: null,
    available: false,
  });
  assert(!fs.existsSync(path.join(root, "executed")));
  assert.equal(fs.readFileSync(target, "utf8"), before);
});

test("CLI report publication exposes complete snapshots even while the next snapshot is partially written", (t) => {
  const { root, write, run, inspect } = fixture(t);
  write("package.json", {
    scripts: { "format:check": 'node -e "console.log(123)"' },
  });
  const preload = write(
    "observe.cjs",
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const original = fs.writeFileSync;
    fs.writeFileSync = (file, data, options) => {
      if (typeof file === 'string' && path.basename(file).startsWith('report.json')) {
        const published = path.join(path.dirname(file), 'report.json');
        if (process.env.ELECTRIFY_STATUS_TEST_IN_PLACE === 'true') file = published;
        // Simulate a reader between two writes, without relying on scheduler timing.
        original(file, data.slice(0, 12), options);
        if (fs.existsSync(published)) JSON.parse(fs.readFileSync(published, 'utf8'));
        fs.appendFileSync('.tmp/observations.log', 'observed\\n');
        original(file, data);
      } else original(file, data, options);
    };
  `,
  );
  const violating = run(["--steps", "formatting"], preload, {
    ELECTRIFY_STATUS_TEST_IN_PLACE: "true",
  });
  assert.equal(
    violating.status,
    1,
    "the observer must catch publication of a partial JSON snapshot",
  );
  assert.match(violating.stderr, /JSON/);
  assert.equal(inspect().status.availability, "unavailable");
  const result = run(["--steps", "formatting"], preload);
  assert.equal(result.status, 0, result.stderr);
  const { status } = inspect();
  assert.equal(status.recordedStatus, "passed");
  assert.equal(status.scope.full, false);
  assert.equal(status.gates[0].log.available, true);
  assert(
    fs
      .readFileSync(path.join(root, ".tmp/observations.log"), "utf8")
      .trim()
      .split("\n").length >= 2,
    "the observer must inspect multiple report publications",
  );
  const files = fs.readdirSync(path.dirname(status.reportPath));
  assert(
    !files.some((name) => name.endsWith(".tmp")),
    "published reports leave no temporary files",
  );
  const oldSummary = run(["--report", status.reportPath]);
  assert.equal(oldSummary.status, 0, oldSummary.stderr);
  assert.match(oldSummary.stdout, /partial\/quick check; 1\/1 gates passed/);
});
