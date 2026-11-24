const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { main } = require("../dev/api-review");

const SCRIPT = path.resolve(__dirname, "../dev/api-review.js");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);

function fixtures(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-api-review-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return (name, data) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, data);
    return file;
  };
}

function balanceCase(seed, finalCash) {
  return {
    case: "ridge-electric-mixed-cash",
    difficulty: "CEO",
    seed,
    outcome: "completed",
    months: 240,
    finalCash,
    finalDebt: 1,
    finalNetWorth: 2,
    servedFraction: 1,
    minimumMarginW: 30_000_000,
    retainedShare: 1.1,
    violations: {},
    objectives: [{ id: "retain-customers", status: "completed" }],
    unusedPayload: "not review evidence",
  };
}

function report(cases, expectedCases = cases.length) {
  return JSON.stringify({ expectedCases, recordedCases: cases.length, cases });
}

function mockApi(t, respond) {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-project-key";
  t.after(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });
  const output = [];
  const stdout = { write: (chunk) => output.push(chunk) };
  const usage = t.mock.method(console, "error", () => {});
  const fetch = t.mock.method(global, "fetch", async (...args) =>
    respond(...args),
  );
  return { fetch, output, stdout, usage };
}

function completedReview() {
  return Response.json({
    status: "completed",
    model: "gpt-6.2-sol",
    output: [
      { type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text: "# Review" }] },
    ],
    usage: { input_tokens: 30, output_tokens: 10 },
  });
}

test("sends ordered screenshot pairs in one request and prints only the review to stdout", async (t) => {
  const file = fixtures(t);
  const images = [
    "before-a.png",
    "after-a.png",
    "before-b.png",
    "after-b.png",
  ].map((name) => file(name, PNG));
  const api = mockApi(t, () => completedReview());
  await main(
    ["visual", ...images, "--intent", "Clearer project totals"],
    api.stdout,
  );

  assert.equal(api.fetch.mock.callCount(), 1);
  const [url, request] = api.fetch.mock.calls[0].arguments;
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer test-project-key");
  const payload = JSON.parse(request.body);
  assert.equal(payload.model, "gpt-6.2-sol");
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 2500);
  assert.match(payload.instructions, /newly introduced visual/);
  const { content } = payload.input[0];
  const names = content.filter((part) => part.text?.startsWith("Pair"));
  assert.deepEqual(
    names.map((part) => part.text),
    [
      "Pair 1, baseline: before-a.png",
      "Pair 1, candidate: after-a.png",
      "Pair 2, baseline: before-b.png",
      "Pair 2, candidate: after-b.png",
    ],
  );
  const attachments = content.filter((part) => part.type === "input_image");
  assert.deepEqual(
    attachments.map((part) => part.image_url),
    Array(4).fill(`data:image/png;base64,${PNG.toString("base64")}`),
  );
  assert.ok(
    content.some((part) => part.text === "PR intent: Clearer project totals"),
  );
  assert.deepEqual(api.output, ["# Review\n"]);
  assert.match(
    api.usage.mock.calls[0].arguments[0],
    /30 input tokens, 10 output tokens/,
  );
});

test("matches balance cases by identity even if report ordering differs", async (t) => {
  const file = fixtures(t);
  const baseline = file(
    "baseline.json",
    report([balanceCase(1, 10), balanceCase(2, 20)]),
  );
  const candidate = file(
    "candidate.json",
    report([balanceCase(2, 25), balanceCase(1, 11)]),
  );
  const api = mockApi(t, () => completedReview());
  await main(["balance", baseline, candidate], api.stdout);

  const payload = JSON.parse(api.fetch.mock.calls[0].arguments[1].body);
  const evidence = JSON.parse(payload.input[0].content.at(-1).text);
  assert.deepEqual(
    evidence.cases.map((row) => [
      row.seed,
      row.baseline.finalCash,
      row.candidate.finalCash,
    ]),
    [
      [1, 10, 11],
      [2, 20, 25],
    ],
  );
  assert.equal(evidence.cases[0].baseline.unusedPayload, undefined);
});

test("rejects incomplete, duplicate, and unmatched balance reports before making a request", async (t) => {
  const file = fixtures(t);
  const baseline = file(
    "baseline.json",
    report([balanceCase(1, 10), balanceCase(2, 20)]),
  );
  const incomplete = file("incomplete.json", report([balanceCase(1, 10)], 2));
  const duplicate = file(
    "duplicate.json",
    report([balanceCase(1, 10), balanceCase(1, 20)]),
  );
  const unmatched = file(
    "unmatched.json",
    report([balanceCase(1, 10), balanceCase(3, 20)]),
  );
  const api = mockApi(t, () => assert.fail("Invalid reports must stay local"));
  await assert.rejects(main(["balance", baseline, incomplete]), /Incomplete/);
  await assert.rejects(
    main(["balance", baseline, duplicate]),
    /Duplicate case/,
  );
  await assert.rejects(main(["balance", baseline, unmatched]), /missing case/);
  assert.equal(api.fetch.mock.callCount(), 0);
});

test("reports API errors without retrying or printing the server's error message", async (t) => {
  const file = fixtures(t);
  const screenshot = file("capture.png", PNG);
  const api = mockApi(t, () =>
    Response.json(
      {
        error: { code: "rate_limit_exceeded", message: "sensitive echo" },
      },
      { status: 429 },
    ),
  );
  await assert.rejects(main(["visual", screenshot, screenshot], api.stdout), {
    message: "OpenAI returned HTTP 429 (rate_limit_exceeded).",
  });
  assert.equal(api.fetch.mock.callCount(), 1);
  assert.deepEqual(api.output, []);
});

test("the CLI reports usage even when the review is incomplete", (t) => {
  const file = fixtures(t);
  const screenshot = file("capture.png", PNG);
  const preload = file(
    "mock-api.cjs",
    "globalThis.fetch = async () => Response.json(JSON.parse(process.env.MOCK_REVIEW_RESULT));",
  );
  const run = (result) =>
    spawnSync(
      process.execPath,
      ["--require", preload, SCRIPT, "visual", screenshot, screenshot],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENAI_API_KEY: "test-project-key",
          MOCK_REVIEW_RESULT: JSON.stringify(result),
        },
      },
    );
  const response = {
    status: "completed",
    model: "mock-review-model",
    output: [
      { type: "message", content: [{ type: "output_text", text: "# Review" }] },
    ],
    usage: { input_tokens: 30, output_tokens: 10 },
  };

  const completed = run(response);
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(completed.stdout, "# Review\n");
  assert.match(
    completed.stderr,
    /mock-review-model: 30 input tokens, 10 output tokens/,
  );

  const incomplete = run({
    ...response,
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: { input_tokens: 30, output_tokens: 2_500 },
  });
  assert.equal(incomplete.status, 1);
  assert.equal(incomplete.stdout, "");
  assert.match(
    incomplete.stderr,
    /OpenAI did not complete the review response/,
  );
  assert.match(
    incomplete.stderr,
    /mock-review-model: 30 input tokens, 2500 output tokens/,
  );
});

test("the CLI dry run works without an API key and rejects an unsupported screenshot", (t) => {
  const file = fixtures(t);
  const screenshot = file("capture.png", PNG);
  const invalid = file("invalid.png", "not an image");
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  const run = (args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env });
  const dryRun = run(["visual", screenshot, screenshot, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /prepared 1 screenshot pair/);
  const failed = run(["visual", screenshot, invalid, "--dry-run"]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Expected a PNG, JPEG, or WebP image/);
  const missingKey = run(["visual", screenshot, screenshot]);
  assert.equal(missingKey.status, 1);
  assert.match(missingKey.stderr, /Set OPENAI_API_KEY/);
});
