#!/usr/bin/env node
// Called only by scripts/deploy.sh after a successful production build.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  cacheControl,
  canonicalPaths,
  requestCode,
  responseCode,
  patchDistribution,
} = require("./policy");
const BUCKET = "electrifygame.com";
const DISTRIBUTION = "E38D57AILAHD00";
const OWNER = "Electrify SEO hosting (scripts/hosting/deploy.js)";

function aws(args, { optional = false } = {}) {
  const result = spawnSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (
      optional &&
      /NoSuchFunctionExists|NoSuchWebsiteConfiguration/.test(
        result.stderr || "",
      )
    )
      return null;
    throw new Error(
      `aws ${args.slice(0, 2).join(" ")} failed: ${result.stderr || result.error}`,
    );
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

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
    const live = aws([
      "cloudfront",
      "get-distribution-config",
      "--id",
      DISTRIBUTION,
    ]);
    const account = aws(["sts", "get-caller-identity"]).Account;
    const names = {
      "viewer-request": "electrify-seo-request",
      "viewer-response": "electrify-seo-response",
    };
    const arns = Object.fromEntries(
      Object.entries(names).map(([event, name]) => [
        event,
        `arn:aws:cloudfront::${account}:function/${name}`,
      ]),
    );
    // Preflight all conflicts before any AWS mutation. Never clobber another viewer function.
    const config = patchDistribution(live.DistributionConfig, arns);
    for (const behavior of [
      config.DefaultCacheBehavior,
      ...(config.CacheBehaviors?.Items || []),
    ]) {
      if (behavior.CachePolicyId) {
        const policy = aws([
          "cloudfront",
          "get-cache-policy",
          "--id",
          behavior.CachePolicyId,
        ]);
        const { MinTTL, MaxTTL } = policy.CachePolicy.CachePolicyConfig;
        if (MinTTL > 300 || MaxTTL < 31536000)
          throw new Error(
            `Cache policy ${behavior.CachePolicyId} clamps SEO lifetimes; use an equivalent policy allowing 300–31536000 seconds before deploying`,
          );
      }
    }
    const existing = {};
    for (const [event, name] of Object.entries(names)) {
      existing[event] = aws(
        ["cloudfront", "describe-function", "--name", name],
        { optional: true },
      );
      if (
        existing[event] &&
        existing[event].FunctionSummary.FunctionConfig.Comment !== OWNER
      )
        throw new Error(`Function ${name} is not owned by this deploy script`);
    }
    const website = aws(["s3api", "get-bucket-website", "--bucket", BUCKET], {
      optional: true,
    });
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
        `s3://${BUCKET}`,
        "--recursive",
        "--exclude",
        "*",
      ];
      for (const file of group) args.push("--include", file);
      args.push("--cache-control", cache, "--only-show-errors");
      if (type) args.push("--content-type", type);
      aws(args);
    }
    for (const [event, name] of Object.entries(names)) {
      const code = path.join(directory, `${name}.js`);
      fs.writeFileSync(
        code,
        event === "viewer-request" ? requestCode(paths) : responseCode(),
      );
      const args = [
        "cloudfront",
        existing[event] ? "update-function" : "create-function",
        "--name",
        name,
        "--function-config",
        jsonFile({ Comment: OWNER, Runtime: "cloudfront-js-2.0" }),
        "--function-code",
        "fileb://" + code,
      ];
      if (existing[event]) args.push("--if-match", existing[event].ETag);
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
        BUCKET,
        "--website-configuration",
        jsonFile({ ...website, ErrorDocument: { Key: "404.html" } }),
      ]);
    aws([
      "cloudfront",
      "update-distribution",
      "--id",
      DISTRIBUTION,
      "--if-match",
      live.ETag,
      "--distribution-config",
      jsonFile(config),
    ]);
    aws(["cloudfront", "wait", "distribution-deployed", "--id", DISTRIBUTION]);
    const invalidation = aws([
      "cloudfront",
      "create-invalidation",
      "--distribution-id",
      DISTRIBUTION,
      "--paths",
      "/*",
    ]);
    aws([
      "cloudfront",
      "wait",
      "invalidation-completed",
      "--distribution-id",
      DISTRIBUTION,
      "--id",
      invalidation.Invalidation.Id,
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    deploy();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { deploy, files };
