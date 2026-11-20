const { execFileSync, spawnSync } = require("node:child_process");
const { STATIC_PAGES } = require("./registry");

const sitePaths = [
  "site/",
  "scripts/site/",
  "package.json",
  "package-lock.json",
  ...STATIC_PAGES.map(({ source }) => source),
  ":(glob)public/images/**/*.svg",
  "public/scenarios.html",
  "public/scenarios/",
  "public/sitemap.xml",
  "public/llms.txt",
];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function checkChangedSite(args) {
  if (args.length > 1)
    throw new Error("Usage: npm run check:prepush -- [base]");
  const base = args[0] ?? "origin/master";
  const commit = git(
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  );
  const changed = git(
    "diff",
    "--name-only",
    "--no-renames",
    `${commit}...HEAD`,
    "--",
    ...sitePaths,
  );
  if (!changed) {
    process.stdout.write("No site inputs or generated pages changed.\n");
    return 0;
  }
  // Compare content so a freshly hydrated LFS working tree can still validate.
  if (
    git("diff", "--name-only", "HEAD", "--", ...sitePaths) ||
    git("ls-files", "--others", "--exclude-standard", "--", ...sitePaths)
  ) {
    throw new Error(
      "Commit or set aside local site changes, then rerun npm run check:prepush on the commit you will push.",
    );
  }

  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, "run", "site:check"],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(
      "After fixing site inputs, regenerate with npm run site:generate -- --date YYYY-MM-DD using the actual authored-change date. Commit the source, metadata and generated output together.",
    );
  }
  return result.status ?? 1;
}

try {
  process.exitCode = checkChangedSite(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
