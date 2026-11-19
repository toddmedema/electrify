// Read-only production readiness, shared by early preflight and the publisher.
const { spawnSync } = require("node:child_process");
const targets = require("./targets.json");
const { patchDistribution } = require("./policy");
const OWNER = "Electrify SEO hosting (scripts/hosting/deploy.js)";

function aws(args, { optional = false } = {}) {
  const result = spawnSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const stderr = result.stderr || "";
    const code = stderr.match(/\((\w+)\) when calling the \w+ operation/)?.[1];
    if (
      optional &&
      /NoSuchFunctionExists|NoSuchWebsiteConfiguration/.test(stderr)
    )
      return null;
    const error = new Error(
      `aws ${args.slice(0, 2).join(" ")} failed: ${stderr || result.error}`,
    );
    error.code = code;
    throw error;
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function readDistributionPlan() {
  const live = aws([
    "cloudfront",
    "get-distribution-config",
    "--id",
    targets.distribution,
  ]);
  const arns = Object.fromEntries(
    Object.entries(targets.functions).map(([event, name]) => [
      event,
      `arn:aws:cloudfront::${targets.account}:function/${name}`,
    ]),
  );
  const config = patchDistribution(live.DistributionConfig, arns);
  const policies = new Set(
    [config.DefaultCacheBehavior, ...(config.CacheBehaviors?.Items || [])]
      .map((behavior) => behavior.CachePolicyId)
      .filter(Boolean),
  );
  for (const id of policies) {
    const policy = aws(["cloudfront", "get-cache-policy", "--id", id]);
    const { MinTTL, MaxTTL } = policy.CachePolicy.CachePolicyConfig;
    if (MinTTL > 300 || MaxTTL < 31536000)
      throw new Error(
        `Cache policy ${id} clamps SEO lifetimes; use an equivalent policy allowing 300–31536000 seconds before deploying`,
      );
  }
  return { live, config };
}

function readHostingPlan({ allowMissingFunctions = false } = {}) {
  const identity = aws(["sts", "get-caller-identity"]);
  if (identity.Account !== targets.account)
    throw new Error(
      `Expected production account ${targets.account}, got ${identity.Account}; use the production deployment credentials`,
    );
  readDistributionPlan();
  const existing = {};
  for (const [event, name] of Object.entries(targets.functions)) {
    existing[event] = aws(
      [
        "cloudfront",
        "describe-function",
        "--name",
        name,
        "--stage",
        "DEVELOPMENT",
      ],
      { optional: true },
    );
    if (!existing[event]) {
      if (!allowMissingFunctions)
        throw new Error(
          `Missing function ${name}; an operator must run node scripts/hosting/provision-functions.js with production provisioning credentials before deploying`,
        );
    } else if (existing[event].FunctionSummary.FunctionConfig.Comment !== OWNER)
      throw new Error(`Function ${name} is not owned by this deploy script`);
  }
  const website = aws(
    ["s3api", "get-bucket-website", "--bucket", targets.bucket],
    { optional: true },
  );
  return { existing, website };
}

module.exports = { OWNER, targets, aws, readDistributionPlan, readHostingPlan };
