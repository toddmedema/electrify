#!/usr/bin/env node
// One-time operator setup. Never invoked by routine deployment or its IAM policy.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { OWNER, targets, aws, readHostingPlan } = require("./plan");
const { canonicalPaths, requestCode, responseCode } = require("./policy");

function provisionFunctions() {
  const paths = canonicalPaths(
    fs.readFileSync(
      path.resolve(__dirname, "../../public/sitemap.xml"),
      "utf8",
    ),
  );
  const { existing } = readHostingPlan({ allowMissingFunctions: true });
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-functions-"),
  );
  try {
    for (const [event, name] of Object.entries(targets.functions)) {
      if (existing[event]) continue;
      const code = path.join(directory, `${name}.js`);
      fs.writeFileSync(
        code,
        event === "viewer-request" ? requestCode(paths) : responseCode(),
      );
      // Create only DEVELOPMENT: publishing/association stays with the next release.
      // A concurrent creator causes an AWS conflict; never fall back to updating it.
      aws([
        "cloudfront",
        "create-function",
        "--name",
        name,
        "--function-config",
        JSON.stringify({ Comment: OWNER, Runtime: "cloudfront-js-2.0" }),
        "--function-code",
        "fileb://" + code,
      ]);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--help")
      process.stdout.write(
        "Usage: AWS_PROFILE=<production-operator> node scripts/hosting/provision-functions.js\nCreates only missing owned SEO functions in DEVELOPMENT; never publishes or overwrites.\nSee docs/seo-audit.md for IAM rollout and credential checks.\n",
      );
    else if (process.argv.length !== 2) throw new Error("Use --help for usage");
    else provisionFunctions();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { provisionFunctions };
