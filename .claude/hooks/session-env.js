#!/usr/bin/env node
// Claude Code SessionStart hook: prepares the Bash tool's environment through $CLAUDE_ENV_FILE so
// agents stop prefixing commands with `PATH=...` and `ELECTRIFY_TASK_ID=...`.
//
//   - When the `node` this hook runs under is not Node 26 (the repository requires >= 26 < 27),
//     the first Node 26 install found in a common location is put first on PATH.
//   - When neither ELECTRIFY_TASK_ID nor CODEX_THREAD_ID (the IDs `npm run task` reads) is set, it
//     defaults ELECTRIFY_TASK_ID to the worktree directory name, so
//     `npm run task -- claim` works and a resumed session keeps owning its earlier claim. Two
//     live sessions in one checkout would share that ID; use a worktree per task, as AGENTS.md says.
//
// It never claims the checkout, prints nothing (SessionStart stdout becomes model context), is a
// no-op when nothing applies, and exits 0 on every error. It runs under whatever `node` is on PATH,
// which may be older than 26, so it sticks to features of Node 18 and later.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WANTED_MAJOR = 26;

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

function readDirectory(directory) {
  try {
    return fs.readdirSync(directory);
  } catch (_error) {
    return [];
  }
}

function compareVersionsDescending(a, b) {
  const parts = (name) => name.replace(/^v/, "").split(".").map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (right[index] || 0) - (left[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

// Bin directories that may hold a Node 26 `node`, most specific installs first. Version managers
// are scanned for directories named like 26.x so a newer major never matches by accident.
function candidateBinDirectories(home, platform, list = readDirectory) {
  if (platform === "win32") return [];
  const managed = (root, tail) =>
    list(root)
      .filter((name) => new RegExp(`^v?${WANTED_MAJOR}(\\.|$)`).test(name))
      .sort(compareVersionsDescending)
      .map((name) => path.join(root, name, tail));
  return [
    `/opt/homebrew/opt/node@${WANTED_MAJOR}/bin`,
    `/usr/local/opt/node@${WANTED_MAJOR}/bin`,
    `/home/linuxbrew/.linuxbrew/opt/node@${WANTED_MAJOR}/bin`,
    ...managed(path.join(home, ".nvm", "versions", "node"), "bin"),
    ...managed(
      path.join(home, ".local", "share", "fnm", "node-versions"),
      path.join("installation", "bin"),
    ),
    ...managed(
      path.join(home, "Library", "Application Support", "fnm", "node-versions"),
      path.join("installation", "bin"),
    ),
    ...managed(path.join(home, ".volta", "tools", "image", "node"), "bin"),
    ...managed(path.join(home, ".asdf", "installs", "nodejs"), "bin"),
    ...managed(
      path.join(home, ".local", "share", "mise", "installs", "node"),
      "bin",
    ),
    ...managed("/usr/local/n/versions/node", "bin"),
  ];
}

function versionOfNodeIn(directory) {
  const binary = path.join(directory, "node");
  if (!fs.existsSync(binary)) return "";
  try {
    return execFileSync(binary, ["-v"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      windowsHide: true,
    }).trim();
  } catch (_error) {
    return "";
  }
}

function findNodeDirectory({
  home,
  platform,
  list,
  versionIn = versionOfNodeIn,
}) {
  return candidateBinDirectories(home, platform, list).find((directory) =>
    versionIn(directory).startsWith(`v${WANTED_MAJOR}.`),
  );
}

function worktreeName(projectDirectory) {
  const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: projectDirectory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
    windowsHide: true,
  }).trim();
  // Keep the ID inert inside double quotes in a shell.
  return path.basename(toplevel).replace(/[^A-Za-z0-9._-]+/g, "-");
}

// The `export` lines to append to the session's env file; empty when nothing applies. Everything
// the machine can vary is a parameter so tests need no real installs.
function sessionEnvLines({
  env = process.env,
  version = process.version,
  home = os.homedir(),
  platform = process.platform,
  list,
  versionIn,
  nameOf = worktreeName,
} = {}) {
  const lines = [];
  if (!version.startsWith(`v${WANTED_MAJOR}.`)) {
    const directory = findNodeDirectory({ home, platform, list, versionIn });
    if (directory) {
      const quoted = shellQuote(directory);
      // Skip only when it is already first: further back, an older `node` would still win.
      lines.push(
        `case ":$PATH:" in :${quoted}:*) ;; *) export PATH=${quoted}:"$PATH" ;; esac`,
      );
    }
  }
  // `npm run task` takes ELECTRIFY_TASK_ID, then CODEX_THREAD_ID; never shadow the second.
  if (!env.ELECTRIFY_TASK_ID && !env.CODEX_THREAD_ID) {
    let name = "";
    try {
      name = nameOf(env.CLAUDE_PROJECT_DIR || process.cwd());
    } catch (_error) {
      // Outside a Git checkout there is no worktree name to use.
    }
    if (name)
      lines.push(`export ELECTRIFY_TASK_ID="\${ELECTRIFY_TASK_ID:-${name}}"`);
  }
  return lines;
}

function appendSessionEnv(envFile, lines) {
  let existing = "";
  try {
    existing = fs.readFileSync(envFile, "utf8");
  } catch (_error) {
    // A new file is fine.
  }
  // SessionStart also fires on resume and compact; do not stack identical lines.
  const present = new Set(existing.split("\n"));
  const fresh = lines.filter((line) => !present.has(line));
  if (fresh.length) fs.appendFileSync(envFile, `${fresh.join("\n")}\n`);
}

function main() {
  try {
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (!envFile) return;
    const lines = sessionEnvLines();
    if (lines.length) appendSessionEnv(envFile, lines);
  } catch (_error) {
    // The session must start even when the environment cannot be prepared.
  }
}

if (require.main === module) main();

module.exports = {
  candidateBinDirectories,
  compareVersionsDescending,
  sessionEnvLines,
  appendSessionEnv,
  worktreeName,
};
