#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--check"))
    throw new Error("Use npm run mods:arcs [-- --check].");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-mod-arcs-"),
  );
  try {
    const resultFile = path.join(directory, "reference.md");
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("react-scripts/bin/react-scripts.js", {
          paths: [path.resolve(__dirname, "..")],
        }),
        "test",
        "--watchAll=false",
        "--runInBand",
        "--cacheDirectory=.tmp/jest-mod-arcs",
        "--testMatch",
        "**/src/testing/ModsArcReferenceCli.tsx",
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, CI: "true", MODS_ARCS_RESULT: resultFile },
      },
    );
    if (result.status !== 0 || !fs.existsSync(resultFile))
      throw new Error(
        result.error?.message ||
          result.stderr ||
          result.stdout ||
          "Arc compilation failed.",
      );
    const content = await require("prettier").format(
      fs.readFileSync(resultFile, "utf8"),
      { parser: "markdown", ...require("../package.json").prettier },
    );
    const target = path.resolve(__dirname, "../docs/mods/arc-reference.md");
    if (process.argv.includes("--check")) {
      if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content)
        throw new Error("Arc reference is stale. Run npm run mods:arcs.");
    } else fs.writeFileSync(target, content);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
});
