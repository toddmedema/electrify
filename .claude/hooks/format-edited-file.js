#!/usr/bin/env node
// Claude Code PostToolUse hook: formats a file Claude just wrote or edited with the repository's
// Prettier, when `npm run format` would cover it. CI rejects unformatted files, so formatting at
// the edit saves a failed check and a formatting-only commit. It never blocks the edit.
const { execFileSync } = require("child_process");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const filePath = JSON.parse(input).tool_input?.file_path;
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    if (!filePath) return;
    const relative = path
      .relative(root, path.resolve(root, filePath))
      .split(path.sep)
      .join("/");
    // Mirrors the globs of the format script in package.json.
    const formatted =
      /^src\/.*\.(tsx?|jsx?|s?css|json)$/.test(relative) ||
      /^scripts\/.*\.js$/.test(relative) ||
      /^e2e\/.*\.ts$/.test(relative) ||
      /^electron\/.*\.cjs$/.test(relative) ||
      relative === "electron-builder.config.cjs";
    if (!formatted) return;
    execFileSync(
      process.execPath,
      [
        require.resolve("prettier/bin/prettier.cjs", { paths: [root] }),
        "--write",
        "--log-level=warn",
        relative,
      ],
      { cwd: root, stdio: ["ignore", "ignore", "inherit"], windowsHide: true },
    );
  } catch (_error) {
    // A syntax error Prettier cannot parse is reported by the next typecheck or lint instead.
  }
});
