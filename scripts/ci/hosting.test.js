const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const { targets, OWNER } = require("../hosting/plan");
const deploymentPolicy = require("../hosting/deployment-policy.v1.json");
const {
  CACHE,
  cacheControl,
  canonicalPaths,
  requestCode,
  responseCode,
  patchDistribution,
} = require("../hosting/policy");

const paths = [
  "/",
  "/about.html",
  "/scenarios.html",
  "/scenarios/deep-freeze.html",
];
function handler(code) {
  const context = {};
  vm.runInNewContext(code, context);
  return context.handler;
}
const functions = {
  "viewer-request": "arn:owned-request",
  "viewer-response": "arn:owned-response",
};
function distribution() {
  return {
    CallerReference: "preserve-me",
    Origins: {
      Quantity: 1,
      Items: [{ Id: "origin", DomainName: "example.s3.amazonaws.com" }],
    },
    DefaultCacheBehavior: {
      TargetOriginId: "origin",
      MinTTL: 86400,
      ForwardedValues: { QueryString: true },
    },
    CacheBehaviors: {
      Quantity: 1,
      Items: [
        {
          PathPattern: "/static/*",
          TargetOriginId: "origin",
          CachePolicyId: "cache-policy",
        },
      ],
    },
    CustomErrorResponses: {
      Quantity: 2,
      Items: [
        { ErrorCode: 500, ResponseCode: "503" },
        {
          ErrorCode: 404,
          ResponseCode: "404",
          ResponsePagePath: "/index.html",
        },
      ],
    },
  };
}

test("cache lifetimes follow content identity and mutable documents revalidate", () => {
  for (const file of [
    "static/js/main.abc123de.js",
    "static/js/861.abc123de.chunk.js",
    "static/css/861.abc123de.chunk.css",
    "static/css/main.abc123de.css",
    "static/js/main.abc123de.js.LICENSE.txt",
    "fonts/inter/InterVariable.woff2",
    "fonts/inter/InterVariable-latin.f222662c.woff2",
  ])
    assert.equal(cacheControl(file), CACHE.immutable, file);
  for (const file of [
    "index.html",
    "about.html",
    "sitemap.xml",
    "robots.txt",
    "llms.txt",
    "static/js/unhashed.js",
    "data/weather/index.json",
  ])
    assert.equal(cacheControl(file), CACHE.short, file);
  assert.equal(cacheControl("analytics.js"), CACHE.moderate);
  assert.equal(cacheControl("fonts/inter/inter.css"), CACHE.moderate);
  assert.equal(cacheControl("images/gameplay-preview.webp"), CACHE.media);
});

test("redirects cover authored clean URLs, preserve queries, and leave canonical and unknown URLs alone", () => {
  const code = requestCode(paths);
  assert.ok(Buffer.byteLength(code) < 10240, "CloudFront function size limit");
  const request = handler(code);
  for (const [uri, target] of [
    ["/index.html", "/"],
    ["/about", "/about.html"],
    ["/about/", "/about.html"],
    ["/about.html/", "/about.html"],
    ["/scenarios/deep-freeze", "/scenarios/deep-freeze.html"],
  ]) {
    const response = request({ request: { uri, querystring: {} } });
    assert.equal(response.statusCode, 301);
    assert.equal(response.headers.location.value, target);
  }
  for (const uri of [
    ...paths,
    "/missing",
    "/missing/",
    "/data/FuelPricesRaw.csv",
    "/About.html",
    "/toString",
    "/constructor",
  ]) {
    const original = { uri, querystring: {} };
    assert.equal(request({ request: original }), original, uri);
  }
  const response = request({
    request: {
      uri: "/index.html",
      querystring: {
        scenario: { value: "108" },
        campaign: {
          value: "heat%20wave",
          multiValue: [{ value: "heat%20wave" }, { value: "cold%2Bwind" }],
        },
      },
    },
  });
  assert.equal(
    response.headers.location.value,
    "/?scenario=108&campaign=heat%20wave&campaign=cold%2Bwind",
  );
});

test("edge headers cover data without changing bodies, statuses, or existing headers", () => {
  const response = handler(responseCode());
  for (const uri of ["/", "/about.html", "/data/FuelPricesRaw.csv"]) {
    const original = {
      statusCode: 200,
      body: "contents",
      headers: { "cache-control": { value: CACHE.short } },
    };
    assert.equal(response({ request: { uri }, response: original }), original);
    assert.equal(
      original.headers["strict-transport-security"].value,
      "max-age=31536000",
    );
    assert.equal(original.headers["cache-control"].value, CACHE.short);
    assert.equal(
      original.headers["x-robots-tag"]?.value,
      uri.startsWith("/data/") ? "noindex" : undefined,
    );
    assert.equal(original.body, "contents");
  }
});

test("distribution patch preserves unrelated configuration and can be applied twice", () => {
  const original = distribution();
  const saved = structuredClone(original);
  const patched = patchDistribution(original, functions);
  assert.deepEqual(original, saved, "patch never mutates the live response");
  assert.deepEqual(patched.Origins, original.Origins);
  assert.equal(patched.CallerReference, original.CallerReference);
  assert.deepEqual(
    patched.DefaultCacheBehavior.ForwardedValues,
    original.DefaultCacheBehavior.ForwardedValues,
  );
  assert.equal(patched.CacheBehaviors.Items[0].CachePolicyId, "cache-policy");
  assert.equal(patched.DefaultCacheBehavior.MinTTL, 0);
  assert.equal(patched.DefaultCacheBehavior.MaxTTL, 31536000);
  assert.deepEqual(patched.CustomErrorResponses.Items, [
    original.CustomErrorResponses.Items[0],
    {
      ErrorCode: 404,
      ResponsePagePath: "/404.html",
      ResponseCode: "404",
      ErrorCachingMinTTL: 60,
    },
  ]);
  assert.deepEqual(patchDistribution(patched, functions), patched);
});

test("foreign viewer functions and viewer Lambda associations fail closed instead of being replaced", () => {
  for (const event of ["viewer-request", "viewer-response"]) {
    const config = distribution();
    config.CacheBehaviors.Items[0].FunctionAssociations = {
      Quantity: 1,
      Items: [{ EventType: event, FunctionARN: "arn:foreign" }],
    };
    assert.throws(
      () => patchDistribution(config, functions),
      /Existing viewer-/,
    );
    const lambda = distribution();
    lambda.DefaultCacheBehavior.LambdaFunctionAssociations = {
      Quantity: 1,
      Items: [{ EventType: event, LambdaFunctionARN: "arn:foreign" }],
    };
    assert.throws(
      () => patchDistribution(lambda, functions),
      /Existing viewer-/,
    );
  }
});

test("sitemap routing rejects empty, duplicate, or foreign canonical URLs", () => {
  const xml =
    "<urlset><url><loc>https://electrifygame.com/</loc></url><url><loc>https://electrifygame.com/about.html</loc></url></urlset>";
  assert.deepEqual(canonicalPaths(xml), ["/", "/about.html"]);
  for (const bad of [
    "<urlset/>",
    xml.replace("/about.html", "/"),
    xml.replace("electrifygame.com/", "example.com/"),
  ])
    assert.throws(() => canonicalPaths(bad), /Sitemap|Unexpected/);
});

test("custom 404 is lightweight, noindex, and offers working site navigation", () => {
  const html = fs.readFileSync(path.resolve("public/404.html"), "utf8");
  const { JSDOM } = require(
    require.resolve("jsdom", {
      paths: [path.dirname(require.resolve("jest-environment-jsdom"))],
    }),
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.equal(
    document.querySelector('meta[name="robots"]').content,
    "noindex",
  );
  assert.equal(document.querySelector("h1").textContent, "Page not found");
  assert.equal(document.querySelector("a").getAttribute("href"), "/");
  assert.equal(document.querySelectorAll("script, #root, template").length, 0);
  assert.ok(Buffer.byteLength(html) < 5000);
  dom.window.close();
});

test("SEO smoke checker accepts a served valid sitemap and rejects representative mutations", () => {
  const result = spawnSync(
    "python3",
    ["-B", "scripts/hosting/test_seo_check.py"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("complete deployed sitemap fits the CloudFront code size limit", () => {
  const xml = fs.readFileSync(path.resolve("public/sitemap.xml"), "utf8");
  assert.ok(Buffer.byteLength(requestCode(canonicalPaths(xml))) <= 10240);
});

function fakeDeployment(
  t,
  config,
  policy = { MinTTL: 0, MaxTTL: 31536000 },
  failUpload = "",
  options = {},
) {
  fs.mkdirSync(path.resolve(".tmp"), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve(".tmp/hosting-deploy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  const build = path.join(directory, "build");
  fs.mkdirSync(bin);
  fs.mkdirSync(build);
  fs.writeFileSync(
    path.join(build, "sitemap.xml"),
    "<urlset><url><loc>https://electrifygame.com/</loc></url></urlset>",
  );
  for (const file of ["index.html", "404.html", "analytics.js", "package.json"])
    fs.writeFileSync(path.join(build, file), "fixture");
  fs.mkdirSync(path.join(build, "static/js"), { recursive: true });
  fs.writeFileSync(path.join(build, "static/js/main.123abcde.js"), "fixture");
  for (const file of [
    "static/css/main.123abcde.css",
    "fonts/inter/InterVariable-latin.123abcde.woff2",
    "images/preview.webp",
  ]) {
    fs.mkdirSync(path.dirname(path.join(build, file)), { recursive: true });
    fs.writeFileSync(path.join(build, file), "fixture");
  }
  const log = path.join(directory, "calls.jsonl");
  const stateFile = path.join(directory, "state.json");
  const state = {
    config,
    policy,
    account: targets.account,
    etag: "distribution-etag",
    functionEtag: "function-etag",
    owner: OWNER,
    ...options.state,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.writeFileSync(log, "");
  fs.writeFileSync(
    path.join(bin, "aws"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const files = Object.fromEntries(args.filter(arg => arg.startsWith('file://')).map(arg => [arg, JSON.parse(fs.readFileSync(arg.slice(7), 'utf8'))]));
const codes = Object.fromEntries(args.filter(arg => arg.startsWith('fileb://')).map(arg => [arg, fs.readFileSync(arg.slice(8), 'utf8')]));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, files, codes }) + '\\n');
if (state.denied === args[1]) { process.stderr.write('AccessDenied: fixture credential cannot ' + args[1]); process.exit(1); }
if (args[0] === 's3' && ${JSON.stringify(failUpload)} && args.includes(${JSON.stringify(failUpload)})) { process.stderr.write('fixture asset upload failed'); process.exit(1); }
let result = {};
if (args[1] === 'get-distribution-config') result = { ETag: state.etag, DistributionConfig: state.config };
if (args[1] === 'get-caller-identity') result = { Account: state.account };
if (args[1] === 'get-cache-policy') result = { CachePolicy: { CachePolicyConfig: state.policy } };
if (args[1] === 'describe-function') {
  if (state.missingFunctions === true || (Array.isArray(state.missingFunctions) && state.missingFunctions.includes(args[args.indexOf('--name') + 1]))) { process.stderr.write('NoSuchFunctionExists'); process.exit(1); }
  result = { ETag: state.functionEtag, FunctionSummary: { FunctionConfig: { Comment: state.owner } } };
}
if (args[1] === 'get-bucket-website') result = { IndexDocument: { Suffix: 'index.html' }, RoutingRules: [{ Condition: { KeyPrefixEquals: 'old/' }, Redirect: { ReplaceKeyPrefixWith: 'new/' } }] };
if (args[1] === 'create-function' || args[1] === 'update-function') result = { ETag: 'updated-function-etag' };
if (args[1] === 'create-invalidation') result = { Invalidation: { Id: 'invalidation-id' } };
process.stdout.write(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "npx"),
    `#!/usr/bin/env node
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: ['firebase', 'deploy'], files: {} }) + '\\n');
`,
    { mode: 0o755 },
  );
  if (options.noBuild) fs.rmSync(build, { recursive: true });
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    FIREBASE_SERVICE_ACCOUNT: "fixture",
    REACT_APP_FIREBASE_API_KEY: "fixture",
  };
  const script = path.resolve("scripts/hosting/deploy.js");
  const run = (args = [], entry = script) =>
    spawnSync(process.execPath, [entry, ...args], {
      cwd: directory,
      encoding: "utf8",
      env,
    });
  const result = run(options.args);
  return {
    result,
    run,
    runShell: (command) =>
      spawnSync("bash", ["-e", "-c", command], {
        cwd: directory,
        encoding: "utf8",
        env,
      }),
    setState: (change) => {
      Object.assign(state, change);
      fs.writeFileSync(stateFile, JSON.stringify(state));
    },
    get calls() {
      return fs
        .readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

const isRead = ({ args }) =>
  [
    "get-distribution-config",
    "get-caller-identity",
    "get-cache-policy",
    "describe-function",
    "get-bucket-website",
  ].includes(args[1]);

test("readiness succeeds without a build or any AWS writes", (t) => {
  const { result, calls } = fakeDeployment(t, distribution(), undefined, "", {
    args: ["--preflight"],
    noBuild: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    calls.filter(({ args }) => args[1] === "describe-function").length,
    2,
  );
  assert.ok(calls.every(isRead));
});

test("production workflow checks hosting readiness before Firebase or AWS mutations", (t) => {
  const fixture = fakeDeployment(t, distribution(), undefined, "", {
    args: ["--preflight"],
    state: { denied: "get-distribution-config" },
  });
  const { jobs } = parse(
    fs.readFileSync(".github/workflows/deploy-prod.yml", "utf8"),
  );
  const steps = jobs.deploy.steps;
  const credentials = steps.findIndex(({ uses }) =>
    uses?.startsWith("aws-actions/configure-aws-credentials@"),
  );
  const preflight = steps.findIndex(({ run }) => run?.includes("--preflight"));
  const firebase = steps.findIndex(({ run }) =>
    run?.includes("firebase-tools@15 deploy"),
  );
  assert.ok(
    credentials >= 0 && credentials < preflight && preflight < firebase,
    "AWS credentials and hosting readiness must precede Firebase deployment",
  );
  const commands = [steps[preflight], steps[firebase]].map(({ run }) =>
    run.replaceAll(
      "node scripts/hosting/deploy.js",
      `node ${path.resolve("scripts/hosting/deploy.js")}`,
    ),
  );
  const result = fixture.runShell(commands.join("\n"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AccessDenied/);
  assert.ok(fixture.calls.every(isRead), JSON.stringify(fixture.calls));
  fixture.setState({ denied: "" });
  const ready = fixture.runShell(commands.join("\n"));
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(
    fixture.calls.filter(({ args }) => args[0] === "firebase").length,
    1,
  );
  assert.ok(
    fixture.calls.filter(({ args }) => args[0] !== "firebase").every(isRead),
  );
});

test("local production command rejects denied hosting access before building", (t) => {
  const fixture = fakeDeployment(t, distribution(), undefined, "", {
    args: ["--preflight"],
    noBuild: true,
    state: { denied: "get-distribution-config" },
  });
  const script = fs
    .readFileSync("scripts/deploy.sh", "utf8")
    .replaceAll(
      "node scripts/hosting/deploy.js",
      `node ${path.resolve("scripts/hosting/deploy.js")}`,
    );
  const result = fixture.runShell(`set -- ci-prod\n${script}`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AccessDenied/);
  assert.ok(fixture.calls.every(isRead));
});

test("deploy rereads readiness after preflight and rejects later conflicts or access denial before upload", (t) => {
  for (const change of [
    { denied: "get-distribution-config" },
    {
      config: {
        ...distribution(),
        DefaultCacheBehavior: {
          ...distribution().DefaultCacheBehavior,
          FunctionAssociations: {
            Quantity: 1,
            Items: [
              { EventType: "viewer-request", FunctionARN: "arn:foreign" },
            ],
          },
        },
      },
    },
  ]) {
    const fixture = fakeDeployment(t, distribution(), undefined, "", {
      args: ["--preflight"],
    });
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    fixture.setState(change);
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AccessDenied|Existing viewer-request/);
    assert.ok(fixture.calls.every(isRead), JSON.stringify(fixture.calls));
  }
});

test("routine deployment requires owned preprovisioned functions and the production account", (t) => {
  for (const [state, expected] of [
    [{ missingFunctions: true }, /provision-functions/],
    [{ owner: "foreign" }, /not owned/],
    [{ account: "123456789012" }, /production account/],
  ]) {
    const { result, calls } = fakeDeployment(t, distribution(), undefined, "", {
      args: ["--preflight"],
      state,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.ok(calls.every(isRead));
  }
});

test("publish uses fresh distribution and function ETags instead of the earlier preflight", (t) => {
  const fixture = fakeDeployment(t, distribution(), undefined, "", {
    args: ["--preflight"],
  });
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  fixture.setState({
    etag: "fresh-distribution-etag",
    functionEtag: "fresh-function-etag",
  });
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  for (const { args } of fixture.calls.filter(({ args }) =>
    ["update-distribution", "update-function"].includes(args[1]),
  ))
    assert.equal(
      args[args.indexOf("--if-match") + 1],
      args[1] === "update-distribution"
        ? "fresh-distribution-etag"
        : "fresh-function-etag",
    );
});

test("operator provisioning creates only missing named functions with current routing and never publishes", (t) => {
  const entry = path.resolve("scripts/hosting/provision-functions.js");
  const names = Object.values(targets.functions);
  const help = fakeDeployment(t, distribution(), undefined, "", {
    args: ["--preflight"],
    state: { denied: "get-distribution-config" },
  });
  const usage = help.run(["--help"], entry);
  assert.equal(usage.status, 0, usage.stderr);
  assert.match(usage.stdout, /Creates only missing/);
  assert.ok(help.calls.every(isRead));
  for (const missingFunctions of [true, [names[1]], false]) {
    const fixture = fakeDeployment(t, distribution(), undefined, "", {
      args: ["--preflight"],
      noBuild: true,
      state: { missingFunctions },
    });
    const result = fixture.run([], entry);
    assert.equal(result.status, 0, result.stderr);
    const writes = fixture.calls.filter((call) => !isRead(call));
    assert.deepEqual(
      writes.map(({ args }) => args[args.indexOf("--name") + 1]),
      missingFunctions === true ? names : missingFunctions || [],
    );
    for (const { args, codes } of writes) {
      assert.equal(args[1], "create-function");
      assert.equal(
        JSON.parse(args[args.indexOf("--function-config") + 1]).Comment,
        OWNER,
      );
      const file = args[args.indexOf("--function-code") + 1];
      assert.equal(
        fs.existsSync(file.slice(8)),
        false,
        "temporary function code is cleaned up",
      );
      const expected = args.includes(names[0])
        ? requestCode(
            canonicalPaths(fs.readFileSync("public/sitemap.xml", "utf8")),
          )
        : responseCode();
      assert.equal(codes[file], expected);
    }
  }
  for (const missingFunctions of [false, [names[0]]]) {
    const foreign = fakeDeployment(t, distribution(), undefined, "", {
      args: ["--preflight"],
      state: { owner: "foreign", missingFunctions },
    });
    const result = foreign.run([], entry);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not owned/);
    assert.ok(foreign.calls.every(isRead));
  }
});

// AWS API-to-IAM mappings, intentionally independent of the deployment owner.
// CLI waiters read the corresponding API; local S3 cp may cancel a multipart upload.
function permissionsFor({ args }) {
  const value = (flag) => {
    assert.ok(args.includes(flag), `missing ${flag}: ${args.join(" ")}`);
    return args[args.indexOf(flag) + 1];
  };
  const cf = `arn:aws:cloudfront::${targets.account}:`;
  if (args[0] === "sts" && args[1] === "get-caller-identity") return [];
  if (args[0] === "s3" && args[1] === "cp") {
    assert.equal(args.includes("--acl"), false);
    const bucket = new URL(args[3]).hostname;
    const files = args.flatMap((arg, index) =>
      arg === "--include" ? [args[index + 1]] : [],
    );
    assert.ok(files.length > 0);
    return files.flatMap((file) =>
      ["s3:PutObject", "s3:AbortMultipartUpload"].map((action) => [
        action,
        `arn:aws:s3:::${bucket}/${file}`,
      ]),
    );
  }
  function valueForDistribution() {
    return args.includes("--distribution-id")
      ? value("--distribution-id")
      : args.includes("--id")
        ? value("--id")
        : "";
  }
  const mappings = {
    "get-distribution-config": "GetDistributionConfig",
    "update-distribution": "UpdateDistribution",
    "create-invalidation": "CreateInvalidation",
  };
  if (args[0] === "cloudfront") {
    if (mappings[args[1]])
      return [
        [
          `cloudfront:${mappings[args[1]]}`,
          `${cf}distribution/${valueForDistribution()}`,
        ],
      ];
    if (args[1] === "wait") {
      assert.ok(
        ["distribution-deployed", "invalidation-completed"].includes(args[2]),
        args.join(" "),
      );
      return [
        [
          args[2] === "distribution-deployed"
            ? "cloudfront:GetDistribution"
            : "cloudfront:GetInvalidation",
          `${cf}distribution/${valueForDistribution()}`,
        ],
      ];
    }
    if (args[1] === "get-cache-policy")
      return [
        ["cloudfront:GetCachePolicy", `${cf}cache-policy/${value("--id")}`],
      ];
    const functions = {
      "describe-function": "DescribeFunction",
      "update-function": "UpdateFunction",
      "publish-function": "PublishFunction",
    };
    if (functions[args[1]])
      return [
        [
          `cloudfront:${functions[args[1]]}`,
          `${cf}function/${value("--name")}`,
        ],
      ];
  }
  if (
    args[0] === "s3api" &&
    ["get-bucket-website", "put-bucket-website"].includes(args[1])
  )
    return [
      [
        args[1] === "get-bucket-website"
          ? "s3:GetBucketWebsite"
          : "s3:PutBucketWebsite",
        `arn:aws:s3:::${value("--bucket")}`,
      ],
    ];
  assert.fail(`Unreviewed release command: ${args.join(" ")}`);
}

function assertPolicyCovers(policy, calls) {
  for (const [action, resource] of calls.flatMap(permissionsFor))
    assert.ok(
      policy.Statement.some(
        (statement) =>
          statement.Effect === "Allow" &&
          [statement.Action].flat().includes(action) &&
          [statement.Resource].flat().some((pattern) =>
            new RegExp(
              `^${pattern
                .split("*")
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join(".*")}$`,
            ).test(resource),
          ),
      ),
      `Policy lacks ${action} on ${resource}`,
    );
}

test("versioned publisher policy covers executed CLI actions, waiter reads, and multipart cancellation with bounded resources", (t) => {
  const { result, calls } = fakeDeployment(t, distribution());
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(deploymentPolicy).sort(), [
    "Statement",
    "Version",
  ]);
  assert.equal(deploymentPolicy.Version, "2012-10-17");
  assertPolicyCovers(deploymentPolicy, calls);
  const failed = fakeDeployment(
    t,
    distribution(),
    undefined,
    "static/js/main.123abcde.js",
  );
  assert.equal(failed.result.status, 1);
  assertPolicyCovers(deploymentPolicy, failed.calls);
  const expectedScopes = {
    "cloudfront:GetDistributionConfig": [
      `arn:aws:cloudfront::${targets.account}:distribution/${targets.distribution}`,
    ],
    "cloudfront:GetDistribution": [
      `arn:aws:cloudfront::${targets.account}:distribution/${targets.distribution}`,
    ],
    "cloudfront:UpdateDistribution": [
      `arn:aws:cloudfront::${targets.account}:distribution/${targets.distribution}`,
    ],
    "cloudfront:CreateInvalidation": [
      `arn:aws:cloudfront::${targets.account}:distribution/${targets.distribution}`,
    ],
    "cloudfront:GetInvalidation": [
      `arn:aws:cloudfront::${targets.account}:distribution/${targets.distribution}`,
    ],
    "cloudfront:GetCachePolicy": ["arn:aws:cloudfront::*:cache-policy/*"],
    ...Object.fromEntries(
      ["DescribeFunction", "UpdateFunction", "PublishFunction"].map(
        (action) => [
          `cloudfront:${action}`,
          Object.values(targets.functions).map(
            (name) => `arn:aws:cloudfront::${targets.account}:function/${name}`,
          ),
        ],
      ),
    ),
    "s3:GetBucketWebsite": [`arn:aws:s3:::${targets.bucket}`],
    "s3:PutBucketWebsite": [`arn:aws:s3:::${targets.bucket}`],
    "s3:PutObject": [`arn:aws:s3:::${targets.bucket}/*`],
    "s3:AbortMultipartUpload": [`arn:aws:s3:::${targets.bucket}/*`],
  };
  const scopes = {};
  for (const statement of deploymentPolicy.Statement) {
    assert.equal(statement.Effect, "Allow");
    assert.equal(statement.Condition, undefined);
    for (const action of [statement.Action].flat()) {
      assert.equal(scopes[action], undefined, `duplicate ${action}`);
      scopes[action] = [statement.Resource].flat();
    }
  }
  assert.deepEqual(scopes, expectedScopes);
  for (const missing of [
    "cloudfront:GetDistributionConfig",
    "cloudfront:GetDistribution",
    "cloudfront:GetInvalidation",
    "s3:AbortMultipartUpload",
  ]) {
    const broken = structuredClone(deploymentPolicy);
    for (const statement of broken.Statement)
      statement.Action = [statement.Action]
        .flat()
        .filter((action) => action !== missing);
    assert.throws(
      () => assertPolicyCovers(broken, calls),
      new RegExp(`Policy lacks ${missing}`),
    );
  }
});

test("deployment uploads cache groups, preserves website rules, and waits before the smoke check", (t) => {
  const { result, calls } = fakeDeployment(t, distribution());
  assert.equal(result.status, 0, result.stderr);
  const uploads = calls.filter(({ args }) => args[0] === "s3");
  assert.ok(
    uploads.some(
      ({ args }) =>
        args.includes(CACHE.immutable) &&
        args.includes("static/js/main.123abcde.js"),
    ),
  );
  const documents = uploads.filter(({ args }) =>
    args.some((arg) => arg.endsWith(".html")),
  );
  const dependencies = uploads.filter(({ args }) =>
    args.some((arg) => /\.(?:js|css|woff2|webp)$/.test(arg)),
  );
  assert.ok(dependencies.length >= 3);
  for (const document of documents)
    for (const dependency of dependencies)
      assert.ok(
        calls.indexOf(dependency) < calls.indexOf(document),
        `dependency upload must finish before ${document.args.join(" ")}`,
      );
  assert.ok(
    uploads.some(
      ({ args }) => args.includes("image/webp") && args.includes(CACHE.media),
    ),
  );
  assert.ok(
    uploads.some(
      ({ args }) =>
        args.includes(CACHE.short) &&
        args.includes("index.html") &&
        args.includes("404.html"),
    ),
  );
  const website = calls.find(({ args }) => args[1] === "put-bucket-website");
  const settings = Object.values(website.files)[0];
  assert.deepEqual(settings.IndexDocument, { Suffix: "index.html" });
  assert.equal(settings.RoutingRules[0].Condition.KeyPrefixEquals, "old/");
  assert.deepEqual(settings.ErrorDocument, { Key: "404.html" });
  const update = calls.find(({ args }) => args[1] === "update-distribution");
  assert.ok(update.args.includes("distribution-etag"));
  assert.deepEqual(
    calls.slice(-3).map(({ args }) => args.slice(1, 3)),
    [
      ["wait", "distribution-deployed"],
      ["create-invalidation", "--distribution-id"],
      ["wait", "invalidation-completed"],
    ],
  );
});

test("a failed asset upload leaves entry documents and edge configuration unpublished", (t) => {
  const { result, calls } = fakeDeployment(
    t,
    distribution(),
    undefined,
    "static/js/main.123abcde.js",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixture asset upload failed/);
  assert.ok(
    calls.some(({ args }) => args.includes("static/js/main.123abcde.js")),
  );
  assert.ok(
    calls.every(
      ({ args }) =>
        !args.some((arg) => arg.endsWith(".html")) &&
        ![
          "create-function",
          "publish-function",
          "put-bucket-website",
          "update-distribution",
        ].includes(args[1]),
    ),
  );
});

test("deployment conflicts and incompatible cache policies abort before any AWS write", (t) => {
  const config = distribution();
  config.DefaultCacheBehavior.FunctionAssociations = {
    Quantity: 1,
    Items: [{ EventType: "viewer-request", FunctionARN: "arn:foreign" }],
  };
  for (const [original, policy, expected] of [
    [config, undefined, /Existing viewer-request/],
    [
      distribution(),
      { MinTTL: 86400, MaxTTL: 31536000 },
      /clamps SEO lifetimes/,
    ],
    [distribution(), { MinTTL: 0, MaxTTL: 86400 }, /clamps SEO lifetimes/],
  ]) {
    const { result, calls } = fakeDeployment(t, original, policy);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.ok(
      calls.every(({ args }) =>
        [
          "get-distribution-config",
          "get-caller-identity",
          "get-cache-policy",
        ].includes(args[1]),
      ),
      JSON.stringify(calls),
    );
  }
});
