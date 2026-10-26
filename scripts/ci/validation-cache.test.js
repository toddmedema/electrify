const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const {
  sourceInputs,
  gateKey,
  digestDirectory,
  evidenceDigest,
  findReusable,
} = require("./validation-cache");

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-validation-cache-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git("init", "--quiet");
  write(
    ".gitignore",
    ".tmp/\nnode_modules/\n.env*\nbuild/\nsrc/data/RunCompatibility.json\npublic/icons.json\npublic/notices*\n",
  );
  write("src/main.ts", "export const answer = 42;\n");
  write("src/main.test.ts", "export const expected = 42;\n");
  write("src/testing/flow.sim.test.ts", "export const seed = 4;\n");
  write("src/testing/helper.ts", "export const helper = 1;\n");
  write("src/setupTests.ts", "export const setup = 1;\n");
  write("e2e/page.spec.ts", "export const width = 360;\n");
  write("public/asset.svg", "<svg/>\n");
  write("package.json", { scripts: { test: "test" } });
  git("add", ".");
  const key = (id, extra = {}) =>
    gateKey(
      { id },
      {
        root,
        inputs: sourceInputs(root),
        command: ["npm", id],
        env: {},
        workers: 4,
        ...extra,
      },
    );
  return { root, write, git, key };
}

test("source inventory retains deleted files and ignored behavioral inputs without commit identity", (t) => {
  const { root, write, git, key } = fixture(t);
  const before = key("tests");
  git(
    "-c",
    "user.name=Cache test",
    "-c",
    "user.email=cache@example.test",
    "commit",
    "--quiet",
    "-m",
    "same bytes",
  );
  assert.equal(key("tests"), before);
  write(".tmp/scratch", "ignored");
  assert.equal(key("tests"), before);
  for (const file of [
    ".env.production.local",
    "node_modules/.package-lock.json",
    "src/data/RunCompatibility.json",
    "public/icons.json",
  ])
    assert(
      sourceInputs(root).some(
        (entry) => entry.path === file && entry.digest === "missing",
      ),
    );
  fs.rmSync(path.join(root, "src/main.ts"));
  assert(
    sourceInputs(root).some(
      (entry) => entry.path === "src/main.ts" && entry.digest === "missing",
    ),
  );
  assert.notEqual(key("tests"), before);
});

test("test-only edits leave unrelated simulation/build keys valid but invalidate owning checks", (t) => {
  const { write, key } = fixture(t);
  const ids = [
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
  const before = Object.fromEntries(ids.map((id) => [id, key(id)]));
  write("src/main.test.ts", "export const expected = 43;\n");
  for (const id of [
    "types",
    "lint",
    "formatting",
    "desktop",
    "tooling",
    "tests",
  ])
    assert.notEqual(key(id), before[id], id);
  for (const id of [
    "simulations",
    "sim",
    "bench",
    "build",
    "bundle",
    "browser",
    "desktop-build",
    "multiplayer",
    "steam-input",
  ])
    assert.equal(key(id), before[id], id);
});

test("simulation tests and e2e changes invalidate their owners without hiding setup and unknown inputs", (t) => {
  const { write, key } = fixture(t);
  const tests = key("tests"),
    simulations = key("simulations"),
    build = key("build"),
    browser = key("browser"),
    formatting = key("formatting");
  write("src/testing/flow.sim.test.ts", "export const seed = 5;\n");
  assert.equal(key("tests"), tests);
  assert.notEqual(key("simulations"), simulations);
  assert.equal(key("build"), build);
  write("e2e/page.spec.ts", "export const width = 390;\n");
  assert.equal(key("tests"), tests);
  assert.equal(key("build"), build);
  assert.notEqual(key("browser"), browser);
  assert.notEqual(key("formatting"), formatting);
  for (const file of [
    "src/setupTests.ts",
    "src/testing/helper.ts",
    "new-rule.txt",
    "public/asset.svg",
    ".env.production.local",
    "node_modules/.package-lock.json",
  ]) {
    const previous = key("build");
    write(file, "changed");
    assert.notEqual(key("build"), previous, file);
  }
});

test("generated edition notices affect renderer gates, not unrelated validation", (t) => {
  const { write, key } = fixture(t);
  const tests = key("tests"),
    build = key("build");
  write("public/notices.json", { edition: "web" });
  write("public/notices-chromium.html", "desktop notices");
  assert.equal(key("tests"), tests);
  assert.notEqual(key("build"), build);
});

test("a production import retains excluded test helpers and their transitive imports", (t) => {
  const { write, key } = fixture(t);
  write("src/main.ts", "export { expected } from './middle';\n");
  write("src/middle.ts", "export { expected } from './main.test';\n");
  const before = key("build");
  write("src/main.test.ts", "export const expected = 43;\n");
  assert.notEqual(key("build"), before);
});

test("TypeScript aliases retain referenced test helpers; dynamic application imports fail closed", (t) => {
  const { write, key } = fixture(t);
  write("tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "fixture/*": ["src/*"] } },
  });
  write("src/main.ts", "export { expected } from 'fixture/main.test';\n");
  let before = key("build");
  write("src/main.test.ts", "export const expected = 44;\n");
  assert.notEqual(key("build"), before);
  write(
    "src/main.ts",
    "const modulePath = './main.test'; import(modulePath);\n",
  );
  before = key("build");
  write("src/main.test.ts", "export const expected = 45;\n");
  assert.notEqual(key("build"), before);
});

test("known non-code imports do not disable test isolation and module worker imports remain covered", (t) => {
  const { write, key } = fixture(t);
  write("src/theme.css", "body { color: blue; }");
  write("src/main.ts", "import './theme.css';\n");
  const before = key("build");
  write("src/main.test.ts", "export const expected = 44;\n");
  assert.equal(key("build"), before);
  write(
    "src/main.ts",
    "new Worker(new URL('./main.test.ts', import.meta.url));\n",
  );
  const worker = key("build");
  write("src/main.test.ts", "export const expected = 45;\n");
  assert.notEqual(key("build"), worker);
});

test("installed package assets preserve test isolation; require.resolve retains local test dependencies", (t) => {
  const { write, key } = fixture(t);
  write("node_modules/chart/package.json", { name: "chart", version: "1.0.0" });
  write("node_modules/chart/style.css", "body { color: blue; }");
  write("src/main.ts", "import 'chart/style.css';\n");
  const before = key("build");
  write("src/main.test.ts", "export const expected = 44;\n");
  assert.equal(key("build"), before);
  write("src/main.ts", "require.resolve('./main.test');\n");
  const referenced = key("build");
  write("src/main.test.ts", "export const expected = 45;\n");
  assert.notEqual(key("build"), referenced);
  write("src/main.ts", "require.resolve(process.env.TEST_MODULE);\n");
  const computed = key("build");
  write("src/main.test.ts", "export const expected = 46;\n");
  assert.notEqual(key("build"), computed);
});

test("ignored local application dependencies cannot produce reusable keys", (t) => {
  const { write, key } = fixture(t);
  write(".tmp/local.ts", "export const expected = 42;\n");
  write("src/main.ts", "export { expected } from '../.tmp/local';\n");
  assert.equal(key("build"), null);
  assert.equal(key("types"), null);
});

test("unknown tooling imports fail closed and edits revoke audited loader exceptions", (t) => {
  const { write, key } = fixture(t);
  write(
    "scripts/perf/helper.js",
    "const target = '../../src/main.test'; require(target);\n",
  );
  const unknown = key("bench");
  write("src/main.test.ts", "export const expected = 43;\n");
  assert.notEqual(key("bench"), unknown);

  write("scripts/perf/helper.js", "// No dynamic loading.\n");
  const native = fs.readFileSync(
    path.resolve(__dirname, "../../electron/steam-native.cjs"),
    "utf8",
  );
  write("electron/steam-native.cjs", native);
  write("node_modules/steamworks.js/package.json", {
    name: "steamworks.js",
    version: "1.0.0",
  });
  write("node_modules/koffi/package.json", {
    name: "koffi",
    version: "1.0.0",
    main: "index.js",
  });
  write("node_modules/koffi/index.js", "module.exports = {};\n");
  const audited = key("bench");
  write("src/main.test.ts", "export const expected = 44;\n");
  assert.equal(key("bench"), audited);
  write(
    "electron/steam-native.cjs",
    native + "\nconst target = '../src/main.test'; require(target);\n",
  );
  const edited = key("bench");
  write("src/main.test.ts", "export const expected = 45;\n");
  assert.notEqual(key("bench"), edited);
});

test("recipe, worker, environment and artifact changes invalidate keys without exposing secrets", (t) => {
  const { key } = fixture(t);
  const secret = "private-value-that-must-not-be-returned";
  const before = key("tests", { env: { TOKEN: secret, FEATURE: "one" } });
  assert.match(before, /^[a-f0-9]{64}$/);
  assert(!before.includes(secret));
  assert.equal(
    key("tests", {
      env: {
        FEATURE: "one",
        TOKEN: secret,
        E2E_PORT: "3911",
        ELECTRIFY_E2E_OUTPUT_DIR: "/tmp/new",
        ELECTRIFY_DEVELOPMENT_LEASE: "another",
        npm_lifecycle_event: "check:ci",
      },
    }),
    before,
  );
  assert.notEqual(
    key("tests", { env: { TOKEN: secret, FEATURE: "two" } }),
    before,
  );
  assert.notEqual(key("tests", { workers: 2 }), key("tests"));
  assert.notEqual(key("tests", { command: ["npm", "changed"] }), key("tests"));
  assert.notEqual(
    key("browser", { artifactDigest: "one" }),
    key("browser", { artifactDigest: "two" }),
  );
});

test(
  "file execution mode changes invalidate source keys on POSIX",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, write, key } = fixture(t);
    write("scripts/example.sh", "exit 0\n");
    fs.chmodSync(path.join(root, "scripts/example.sh"), 0o644);
    const before = key("tests");
    fs.chmodSync(path.join(root, "scripts/example.sh"), 0o755);
    assert.notEqual(key("tests"), before);
  },
);

test("artifact digests detect edits, deletions, new membership and symlinks", (t) => {
  const { root, write } = fixture(t);
  write("build/index.html", "complete");
  const directory = path.join(root, "build"),
    before = digestDirectory(directory);
  write("build/index.html", "changed");
  assert.notEqual(digestDirectory(directory), before);
  write("build/index.html", "complete");
  assert.equal(digestDirectory(directory), before);
  write("build/extra.js", "new");
  assert.notEqual(digestDirectory(directory), before);
  fs.rmSync(path.join(directory, "extra.js"));
  fs.mkdirSync(path.join(root, "outside"));
  fs.symlinkSync(
    path.join(root, "outside"),
    path.join(directory, "link"),
    "junction",
  );
  assert.throws(() => digestDirectory(directory), /not a regular file/);
  fs.rmSync(path.join(directory, "link"));
  fs.rmSync(path.join(directory, "index.html"));
  assert.notEqual(digestDirectory(directory), before);
  assert.throws(() => digestDirectory(path.join(root, "absent")), /ENOENT/);
});

function evidence(t, step = { id: "tests" }, artifactDigest) {
  const value = fixture(t),
    { root, write } = value;
  const directory = path.join(root, ".tmp/check-runs/2026-01-01");
  const gate = {
    id: step.id,
    status: "passed",
    exitCode: 0,
    execution: "executed",
    inputKey: "matching",
    artifactDigest,
    log: `${step.id}.log`,
    reports: (step.reports || []).map((file) => `${step.id}/${file}`),
  };
  write(`.tmp/check-runs/2026-01-01/${gate.log}`, "passed output");
  for (const file of gate.reports)
    write(`.tmp/check-runs/2026-01-01/${file}`, {
      stats: { expected: 1, unexpected: 0, flaky: 0 },
    });
  gate.evidenceDigest = evidenceDigest(directory, gate);
  const report = {
    schemaVersion: 1,
    status: "passed",
    finishedAt: "2026-01-01T01:00:00Z",
    source: {
      before: { fingerprint: "same" },
      after: { fingerprint: "same" },
      changedDuringRun: false,
    },
    gates: [gate],
  };
  const save = () => write(".tmp/check-runs/2026-01-01/report.json", report);
  save();
  return {
    ...value,
    directory,
    gate,
    report,
    save,
    find: () =>
      findReusable(path.dirname(directory), step, "matching", artifactDigest),
  };
}

test("only completed unchanged reports offer passed gate evidence, including previously reused gates", (t) => {
  const { report, gate, save, find } = evidence(t);
  assert(find());
  report.status = "failed";
  gate.execution = "reused";
  save();
  assert(find());
  for (const status of ["running", "invalidated"]) {
    report.status = status;
    save();
    assert.equal(find(), null);
  }
  report.status = "passed";
  report.source.after.fingerprint = "changed";
  save();
  assert.equal(find(), null);
  report.source.after.fingerprint = "same";
  report.source.behaviorBefore = "first";
  report.source.behaviorAfter = "second";
  save();
  assert.equal(find(), null);
});

test("missing, corrupt or modified gate output is never reusable", (t) => {
  const { write, directory, gate, find } = evidence(
    t,
    { id: "browser", reports: ["results.json"] },
    "artifact",
  );
  assert(find());
  write(".tmp/check-runs/2026-01-01/browser/results.json", "not json");
  assert.equal(find(), null);
  write(".tmp/check-runs/2026-01-01/browser/results.json", {
    stats: { expected: 1, unexpected: 0, flaky: 0 },
  });
  assert(find());
  fs.appendFileSync(path.join(directory, gate.log), "altered");
  assert.equal(find(), null);
  fs.rmSync(path.join(directory, gate.log));
  assert.equal(find(), null);
});

test("artifact mismatch, failed gate, duplicate gate or missing required report rejects reuse", (t) => {
  const { directory, report, gate, save, find } = evidence(
    t,
    { id: "browser", reports: ["results.json"] },
    "artifact",
  );
  const reports = path.dirname(directory),
    step = { id: "browser", reports: ["results.json"] };
  assert.equal(findReusable(reports, step, "matching", "other"), null);
  assert.equal(findReusable(reports, step, "matching"), null);
  gate.status = "failed";
  save();
  assert.equal(find(), null);
  gate.status = "passed";
  report.gates.push({ ...gate });
  save();
  assert.equal(find(), null);
  report.gates.pop();
  gate.reports = [];
  gate.evidenceDigest = evidenceDigest(directory, gate);
  save();
  assert.equal(find(), null);
});

test("evidence paths cannot escape the report or traverse symlinks", (t) => {
  const { root, directory, gate } = evidence(t);
  for (const log of [
    "../outside",
    "/absolute",
    "C:\\outside",
    "nested/../../outside",
  ])
    assert.throws(
      () => evidenceDigest(directory, { ...gate, log }),
      /relative|Unsafe/,
    );
  fs.mkdirSync(path.join(root, "outside"));
  fs.writeFileSync(path.join(root, "outside/log"), "external");
  fs.symlinkSync(
    path.join(root, "outside"),
    path.join(directory, "linked"),
    "junction",
  );
  assert.throws(
    () => evidenceDigest(directory, { ...gate, log: "linked/log" }),
    /Symlinked/,
  );
});
