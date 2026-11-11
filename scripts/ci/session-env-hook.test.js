const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  candidateBinDirectories,
  compareVersionsDescending,
  sessionEnvLines,
  appendSessionEnv,
  worktreeName,
} = require("../../.claude/hooks/session-env");

const hook = path.resolve(".claude/hooks/session-env.js");
const posix = process.platform !== "win32";

function temporaryDirectory(t, prefix = "electrify-session-env-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// An executable-looking `node` in a version manager layout, plus the layout's other majors.
function fakeNvm(home, versions) {
  for (const version of versions) {
    const bin = path.join(home, ".nvm", "versions", "node", version, "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "node"), "");
  }
}

const reportsItsDirectoryName = (directory) =>
  (directory.match(/v\d+\.\d+\.\d+/) || [""])[0];

test("version directories sort numerically, newest first", () => {
  assert.deepEqual(
    ["v26.2.0", "26.10.1", "v26.10.0", "v26"].sort(compareVersionsDescending),
    ["26.10.1", "v26.10.0", "v26.2.0", "v26"],
  );
});

test("only Node 26 version-manager installs are candidates", (t) => {
  const home = temporaryDirectory(t);
  fakeNvm(home, ["v24.22.2", "v26.2.0", "v26.10.1", "v260.0.0", "v25.0.0"]);
  const nvm = candidateBinDirectories(home, "darwin").filter((directory) =>
    directory.startsWith(path.join(home, ".nvm")),
  );
  assert.deepEqual(nvm, [
    path.join(home, ".nvm", "versions", "node", "v26.10.1", "bin"),
    path.join(home, ".nvm", "versions", "node", "v26.2.0", "bin"),
  ]);
  assert.deepEqual(candidateBinDirectories(home, "win32"), []);
});

test("nothing is written when Node 26 and a task ID are already in place", () => {
  assert.deepEqual(
    sessionEnvLines({
      version: "v26.13.0",
      env: { ELECTRIFY_TASK_ID: "mine" },
      nameOf: () => assert.fail("must not look up a name"),
    }),
    [],
  );
});

test("a default Node other than 26 gets the newest installed Node 26 first on PATH", (t) => {
  const home = temporaryDirectory(t);
  fakeNvm(home, ["v26.2.0", "v26.10.1"]);
  const lines = sessionEnvLines({
    version: "v24.22.2",
    env: { ELECTRIFY_TASK_ID: "mine" },
    home,
    platform: "linux",
    versionIn: reportsItsDirectoryName,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /v26\.10\.1/);
  assert.doesNotMatch(lines[0], /v26\.2\.0/);
});

test("a candidate whose node is not Node 26 is skipped, and no candidate means no PATH line", (t) => {
  const home = temporaryDirectory(t);
  fakeNvm(home, ["v26.2.0"]);
  const env = { ELECTRIFY_TASK_ID: "mine" };
  assert.deepEqual(
    sessionEnvLines({
      version: "v24.22.2",
      env,
      home,
      platform: "linux",
      versionIn: () => "v25.0.0",
    }),
    [],
  );
  assert.deepEqual(
    sessionEnvLines({
      version: "v24.22.2",
      env,
      home: path.join(home, "empty"),
      platform: "linux",
      versionIn: () => "",
    }),
    [],
  );
});

test(
  "the PATH line survives spaces in the directory and is idempotent when sourced twice",
  { skip: !posix },
  (t) => {
    const home = temporaryDirectory(t, "electrify session env ");
    fakeNvm(home, ["v26.2.0"]);
    const [line] = sessionEnvLines({
      version: "v24.22.2",
      env: { ELECTRIFY_TASK_ID: "mine" },
      home,
      platform: "linux",
      versionIn: reportsItsDirectoryName,
    });
    const nodeBin = path.join(
      home,
      ".nvm",
      "versions",
      "node",
      "v26.2.0",
      "bin",
    );
    const lookup = (script, PATH = "/usr/bin:/bin") =>
      execFileSync("/bin/sh", ["-c", script], {
        env: { PATH },
        encoding: "utf8",
      }).trim();
    assert.equal(
      lookup(`${line}\n${line}\necho "$PATH"`),
      `${nodeBin}:/usr/bin:/bin`,
    );
    // Already first: untouched. Already on PATH behind another node: still moved to the front.
    const first = `${nodeBin}:/usr/bin`;
    assert.equal(lookup(`${line}\necho "$PATH"`, first), first);
    const behind = `/usr/bin:${nodeBin}:/bin`;
    assert.equal(
      lookup(`${line}\necho "$PATH"`, behind),
      `${nodeBin}:${behind}`,
    );
  },
);

test("the task ID defaults to the worktree name and never overrides one that is set", () => {
  const unnamed = sessionEnvLines({
    version: "v26.13.0",
    env: { CLAUDE_PROJECT_DIR: "/somewhere" },
    nameOf: (directory) => {
      assert.equal(directory, "/somewhere");
      return "facilities-chart-9c6533";
    },
  });
  assert.deepEqual(unnamed, [
    `export ELECTRIFY_TASK_ID="\${ELECTRIFY_TASK_ID:-facilities-chart-9c6533}"`,
  ]);
  assert.deepEqual(
    sessionEnvLines({
      version: "v26.13.0",
      env: { ELECTRIFY_TASK_ID: "set" },
      nameOf: () => "ignored",
    }),
    [],
  );
});

test("a Codex thread ID that `npm run task` already reads is not shadowed", () => {
  assert.deepEqual(
    sessionEnvLines({
      version: "v26.13.0",
      env: { CODEX_THREAD_ID: "thread-1" },
      nameOf: () => "worktree-name",
    }),
    [],
  );
});

test("a failed worktree lookup drops only the task ID line", (t) => {
  const home = temporaryDirectory(t);
  fakeNvm(home, ["v26.2.0"]);
  const lines = sessionEnvLines({
    version: "v24.22.2",
    env: {},
    home,
    platform: "linux",
    versionIn: reportsItsDirectoryName,
    nameOf: () => {
      throw new Error("not a repository");
    },
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^case /);
});

test("the worktree name is the checkout directory, made shell-inert", (t) => {
  const parent = temporaryDirectory(t);
  const checkout = path.join(parent, "my work tree's");
  fs.mkdirSync(path.join(checkout, "src"), { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: checkout });
  assert.equal(worktreeName(checkout), "my-work-tree-s");
  // Any directory inside the checkout resolves to the same name.
  assert.equal(worktreeName(path.join(checkout, "src")), "my-work-tree-s");
  assert.throws(() => worktreeName(parent));
});

test("appended lines are not repeated when the hook fires again", (t) => {
  const file = path.join(temporaryDirectory(t), "env");
  appendSessionEnv(file, ["export A=1", "export B=2"]);
  appendSessionEnv(file, ["export B=2", "export C=3"]);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "export A=1\nexport B=2\nexport C=3\n",
  );
});

test("the hook is silent, appends to the env file, and always exits 0", (t) => {
  const parent = temporaryDirectory(t);
  const checkout = path.join(parent, "task-checkout");
  fs.mkdirSync(checkout);
  execFileSync("git", ["init", "--quiet"], { cwd: checkout });
  const file = path.join(parent, "claude-env");
  const run = (env) => {
    const base = { ...process.env, CLAUDE_PROJECT_DIR: checkout };
    delete base.ELECTRIFY_TASK_ID;
    delete base.CODEX_THREAD_ID;
    delete base.CLAUDE_ENV_FILE;
    const result = spawnSync(process.execPath, [hook], {
      cwd: parent,
      env: { ...base, ...env },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      "",
      "SessionStart stdout becomes model context",
    );
    assert.equal(result.stderr, "");
  };

  run({ CLAUDE_ENV_FILE: file });
  const first = fs.readFileSync(file, "utf8");
  assert.match(
    first,
    /^export ELECTRIFY_TASK_ID="\$\{ELECTRIFY_TASK_ID:-task-checkout\}"$/m,
  );
  for (const line of first.trim().split("\n"))
    assert.match(line, /^(export |case )/);
  run({ CLAUDE_ENV_FILE: file });
  assert.equal(fs.readFileSync(file, "utf8"), first);

  const untouched = path.join(parent, "untouched");
  run({ CLAUDE_ENV_FILE: untouched, ELECTRIFY_TASK_ID: "preset" });
  if (process.version.startsWith("v26."))
    assert.equal(fs.existsSync(untouched), false);

  run({});
  run({ CLAUDE_ENV_FILE: path.join(parent, "missing", "directory", "env") });
  run({ CLAUDE_PROJECT_DIR: parent, CLAUDE_ENV_FILE: file });
});

test("settings register the SessionStart hook at a file that exists", () => {
  const settings = JSON.parse(
    fs.readFileSync(path.resolve(".claude/settings.json"), "utf8"),
  );
  const commands = settings.hooks.SessionStart.flatMap((entry) =>
    entry.hooks.map((registered) => registered.command),
  );
  assert.deepEqual(commands, [
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/session-env.js"',
  ]);
  assert(fs.existsSync(hook));
});
