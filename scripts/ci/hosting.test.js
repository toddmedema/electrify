const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
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
  fs.writeFileSync(
    path.join(bin, "aws"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const files = Object.fromEntries(args.filter(arg => arg.startsWith('file://')).map(arg => [arg, JSON.parse(fs.readFileSync(arg.slice(7), 'utf8'))]));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, files }) + '\\n');
if (args[0] === 's3' && ${JSON.stringify(failUpload)} && args.includes(${JSON.stringify(failUpload)})) { process.stderr.write('fixture asset upload failed'); process.exit(1); }
let result = {};
if (args[1] === 'get-distribution-config') result = { ETag: 'distribution-etag', DistributionConfig: ${JSON.stringify(config)} };
if (args[1] === 'get-caller-identity') result = { Account: '123' };
if (args[1] === 'get-cache-policy') result = { CachePolicy: { CachePolicyConfig: ${JSON.stringify(policy)} } };
if (args[1] === 'describe-function') { process.stderr.write('NoSuchFunctionExists'); process.exit(1); }
if (args[1] === 'get-bucket-website') result = { IndexDocument: { Suffix: 'index.html' }, RoutingRules: [{ Condition: { KeyPrefixEquals: 'old/' }, Redirect: { ReplaceKeyPrefixWith: 'new/' } }] };
if (args[1] === 'create-function') result = { ETag: 'function-etag' };
if (args[1] === 'create-invalidation') result = { Invalidation: { Id: 'invalidation-id' } };
process.stdout.write(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts/hosting/deploy.js")],
    {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      },
    },
  );
  return {
    result,
    calls: fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}

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
