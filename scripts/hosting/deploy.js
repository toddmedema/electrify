#!/usr/bin/env node
// --preflight is read-only and needs no build; publishing always reads a fresh plan.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { OWNER, targets, aws, readHostingPlan } = require("./plan");
const {
  cacheControl,
  canonicalPaths,
  requestCode,
  responseCode,
} = require("./policy");

function files(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const relative = prefix + item.name;
    return item.isDirectory()
      ? files(path.join(directory, item.name), relative + "/")
      : [relative];
  });
}

function deploy() {
  const build = path.resolve("build");
  const paths = canonicalPaths(
    fs.readFileSync(path.join(build, "sitemap.xml"), "utf8"),
  );
  if (!fs.existsSync(path.join(build, "404.html")))
    throw new Error("Missing built 404 page");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-hosting-"),
  );
  let sequence = 0;
  function jsonFile(value) {
    const target = path.join(directory, `${sequence++}.json`);
    fs.writeFileSync(target, JSON.stringify(value));
    return "file://" + target;
  }
  try {
    const { live, config, existing, website } = readHostingPlan();
    // Content first: a new edge mapping must never reference an absent page.
    const groups = new Map();
    for (const file of files(build)) {
      const cache = file === "package.json" ? "no-cache" : cacheControl(file);
      const type = file.endsWith(".webp") ? "image/webp" : "";
      const key = JSON.stringify([file.endsWith(".html"), cache, type]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(file);
    }
    // S3 copies publish immediately, without a staged release. Finish every asset
    // group before any entry document can reference the new build's dependencies.
    const ordered = [...groups].sort(
      ([left], [right]) => JSON.parse(left)[0] - JSON.parse(right)[0],
    );
    for (const [key, group] of ordered) {
      const [, cache, type] = JSON.parse(key);
      const args = [
        "s3",
        "cp",
        build,
        `s3://${targets.bucket}`,
        "--recursive",
        "--exclude",
        "*",
      ];
      for (const file of group) args.push("--include", file);
      args.push("--cache-control", cache, "--only-show-errors");
      if (type) args.push("--content-type", type);
      aws(args);
    }
    for (const [event, name] of Object.entries(targets.functions)) {
      const code = path.join(directory, `${name}.js`);
      fs.writeFileSync(
        code,
        event === "viewer-request" ? requestCode(paths) : responseCode(),
      );
      const args = [
        "cloudfront",
        "update-function",
        "--name",
        name,
        "--function-config",
        jsonFile({ Comment: OWNER, Runtime: "cloudfront-js-2.0" }),
        "--function-code",
        "fileb://" + code,
        "--if-match",
        existing[event].ETag,
      ];
      const result = aws(args);
      aws([
        "cloudfront",
        "publish-function",
        "--name",
        name,
        "--if-match",
        result.ETag,
      ]);
    }
    // Preserve the index document, routing rules, origins, policies, and other errors.
    if (website)
      aws([
        "s3api",
        "put-bucket-website",
        "--bucket",
        targets.bucket,
        "--website-configuration",
        jsonFile({ ...website, ErrorDocument: { Key: "404.html" } }),
      ]);
    aws([
      "cloudfront",
      "update-distribution",
      "--id",
      targets.distribution,
      "--if-match",
      live.ETag,
      "--distribution-config",
      jsonFile(config),
    ]);
    aws([
      "cloudfront",
      "wait",
      "distribution-deployed",
      "--id",
      targets.distribution,
    ]);
    const invalidation = aws([
      "cloudfront",
      "create-invalidation",
      "--distribution-id",
      targets.distribution,
      "--paths",
      "/*",
    ]);
    aws([
      "cloudfront",
      "wait",
      "invalidation-completed",
      "--distribution-id",
      targets.distribution,
      "--id",
      invalidation.Invalidation.Id,
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--preflight")
      readHostingPlan();
    else if (process.argv.length !== 2)
      throw new Error("Usage: node scripts/hosting/deploy.js [--preflight]");
    else deploy();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { deploy, files };
