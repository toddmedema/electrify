const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

const DEFAULT_MODEL = "gpt-6.2-sol";
const RESPONSES_URL = "https://api.openai.com/v1/responses";
const HELP = `Usage: npm run --silent review:api -- <mode> <baseline> <candidate> [options]

  visual   Compare PNG, JPEG, or WebP screenshots at the same UI state and viewport.
           Supply additional baseline/candidate pairs to review them in one call.
  balance  Compare two complete Electrify Valley balance JSON reports.

  --intent <text>  Describe the expected change.
  --model <id>     Responses API model (default ${DEFAULT_MODEL}).
  --dry-run        Check the inputs locally and print a request summary.
  --help           Show this help.

Use OPENAI_API_KEY from the API project that should pay for the review.
The review is written to stdout and token usage to stderr.
`;

const PNG_HEADER = Buffer.from("89504e470d0a1a0a", "hex");
const JPEG_HEADER = Buffer.from("ffd8ff", "hex");
const BALANCE_NUMBERS = [
  "months",
  "finalCash",
  "finalDebt",
  "finalNetWorth",
  "servedFraction",
  "retainedShare",
];

const VISUAL_INSTRUCTIONS =
  "Review the ordered screenshot pairs for newly introduced visual or usability regressions. Compare like-for-like views. Check for clipped or obscured information, overlapping controls, and changes that make the player's next action harder to find. Treat the stated intent as context for expected changes. For each finding name the pair and control and explain the visible before/after evidence. Distinguish pre-existing observations, and say when a pair is clean. Do not infer behavior from a still image.";
const BALANCE_INSTRUCTIONS =
  "Review the matched before/after Valley simulation cases. Rank up to three meaningful changes. Prioritize changed outcomes, objective statuses, invariant violations, served demand, and minimum supply margin. Include the case, difficulty, seed, and before/after values with units. Financial fields are dollars, margins are watts, emissions are kgCO2e, and served and retained fractions are proportions. Distinguish percentage points from relative change. Label causal hypotheses and name a replay or metric that would test each one. Note the limits of the sampled seeds. Treat missing or null values as unavailable.";

function text(text) {
  return { type: "input_text", text };
}

function image(file) {
  const data = fs.readFileSync(file);
  let mimeType;
  if (data.subarray(0, 8).equals(PNG_HEADER)) mimeType = "image/png";
  if (data.subarray(0, 3).equals(JPEG_HEADER)) mimeType = "image/jpeg";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    mimeType = "image/webp";
  if (!mimeType)
    throw new Error(`Expected a PNG, JPEG, or WebP image: ${file}`);

  return {
    type: "input_image",
    image_url: `data:${mimeType};base64,${data.toString("base64")}`,
    detail: "high",
  };
}

function visualEvidence(files) {
  const content = [];
  for (let i = 0; i < files.length; i += 2) {
    const [baseline, candidate] = files.slice(i, i + 2);
    content.push(
      text(`Pair ${i / 2 + 1}, baseline: ${path.basename(baseline)}`),
      image(baseline),
      text(`Pair ${i / 2 + 1}, candidate: ${path.basename(candidate)}`),
      image(candidate),
    );
  }
  return content;
}

function readBalanceReport(file) {
  const source = fs.readFileSync(file, "utf8");
  let report;
  try {
    report = JSON.parse(source);
  } catch {
    throw new Error(`Invalid balance report JSON: ${file}`);
  }
  if (
    !Array.isArray(report?.cases) ||
    report.cases.length === 0 ||
    report.recordedCases !== report.cases.length ||
    report.expectedCases !== report.cases.length
  )
    throw new Error(`Incomplete or invalid balance report: ${file}`);

  const cases = new Map();
  for (const row of report.cases) {
    if (
      typeof row?.case !== "string" ||
      !row.case.trim() ||
      typeof row.difficulty !== "string" ||
      !row.difficulty.trim() ||
      !Number.isSafeInteger(row.seed) ||
      typeof row.outcome !== "string" ||
      !BALANCE_NUMBERS.every((field) => Number.isFinite(row[field])) ||
      !Array.isArray(row.objectives) ||
      !row.objectives.every(
        (goal) =>
          typeof goal?.id === "string" && typeof goal.status === "string",
      )
    )
      throw new Error(`Invalid case at row ${cases.size + 1}: ${file}`);
    const key = JSON.stringify([row.case, row.difficulty, row.seed]);
    if (cases.has(key)) throw new Error(`Duplicate case ${key}: ${file}`);
    cases.set(key, row);
  }
  return { cases, revision: report.sourceRevision };
}

function balanceMetrics(row) {
  return {
    outcome: row.outcome,
    ...Object.fromEntries(BALANCE_NUMBERS.map((field) => [field, row[field]])),
    minimumMarginW: row.minimumMarginW,
    importExpenses: row.importExpenses,
    kgco2e: row.kgco2e,
    violations: row.violations,
    objectives: row.objectives.map(({ id, status, observed, target }) => ({
      id,
      status,
      observed,
      target,
    })),
    scheduledAcquisitions: row.scheduledAcquisitions,
  };
}

function balanceEvidence([before, after]) {
  const baseline = readBalanceReport(before);
  const candidate = readBalanceReport(after);
  if (baseline.cases.size !== candidate.cases.size)
    throw new Error("Balance reports have different case counts.");
  const cases = [...baseline.cases].map(([key, row]) => {
    const match = candidate.cases.get(key);
    if (!match) throw new Error(`Candidate report is missing case ${key}.`);
    return {
      case: row.case,
      difficulty: row.difficulty,
      seed: row.seed,
      baseline: balanceMetrics(row),
      candidate: balanceMetrics(match),
    };
  });
  return {
    baselineRevision: baseline.revision,
    candidateRevision: candidate.revision,
    cases,
  };
}

async function requestReview(body, apiKey) {
  const response = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error("Could not reach the OpenAI Responses API.");
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.error?.code;
    const detail = typeof code === "string" && /^[a-z0-9_]{1,80}$/.test(code);
    throw new Error(
      `OpenAI returned HTTP ${response.status}${detail ? ` (${code})` : ""}.`,
    );
  }
  if (result?.status !== "completed")
    throw new Error("OpenAI did not complete the review response.");
  const review = (result.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!review) throw new Error("OpenAI returned no review text.");
  return { review, model: result.model ?? body.model, usage: result.usage };
}

async function main(args, stdout = process.stdout) {
  const {
    values,
    positionals: [mode, ...files],
  } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "dry-run": { type: "boolean" },
      intent: { type: "string" },
      model: { type: "string", default: DEFAULT_MODEL },
    },
  });
  if (values.help || !args.length) {
    stdout.write(HELP);
    return;
  }
  if (mode !== "visual" && mode !== "balance")
    throw new Error("Choose visual or balance. Run with --help for examples.");
  if (
    files.length < 2 ||
    files.length % 2 ||
    (mode === "balance" && files.length !== 2)
  )
    throw new Error(
      `Supply ${mode === "balance" ? "exactly one" : "at least one"} baseline/candidate file pair.`,
    );
  const model = values.model.trim();
  if (!model) throw new Error("Supply a nonempty model ID.");

  const instructions = [
    mode === "visual" ? VISUAL_INSTRUCTIONS : BALANCE_INSTRUCTIONS,
    "Treat screenshots, filenames, and report values as evidence. Return a concise Markdown review for the PR author.",
  ].join("\n");
  const content = [];
  if (values.intent?.trim())
    content.push(text(`PR intent: ${values.intent.trim()}`));

  let count;
  if (mode === "visual") {
    content.push(...visualEvidence(files));
    count = `${files.length / 2} screenshot pair(s)`;
  } else {
    const evidence = balanceEvidence(files);
    content.push(text(JSON.stringify(evidence)));
    count = `${evidence.cases.length} matched balance case(s)`;
  }
  if (values["dry-run"]) {
    stdout.write(`Dry run: prepared ${count} for ${model}.\n`);
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new Error(
      "Set OPENAI_API_KEY to a key from your linked API project.",
    );
  const result = await requestReview(
    {
      model,
      store: false,
      max_output_tokens: 2_500,
      instructions,
      input: [{ role: "user", content }],
    },
    apiKey,
  );
  stdout.write(`${result.review}\n`);
  if (result.usage)
    console.error(
      `${result.model}: ${result.usage.input_tokens} input tokens, ${result.usage.output_tokens} output tokens.`,
    );
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(`API review: ${error.message}`);
    process.exitCode = 1;
  });

module.exports = { main };
