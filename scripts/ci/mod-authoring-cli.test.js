const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { parseSimArguments } = require("../sim");
const { parseValidationArguments } = require("../mods-validate");

test("mod flags bind files and explicit responses without changing normal simulation arguments", () => {
  assert.deepEqual(parseSimArguments(["--all", "--seed", "0"], {}), {
    action: "run",
    env: { CI: "true", SIM_ALL: "1", SIM_SEED: "0" },
  });
  assert.deepEqual(
    parseSimArguments(
      [
        "--mod",
        "scenario.json",
        "--responses",
        "answers.json",
        "--seeds",
        "0,17",
        "--difficulties",
        "Intern,CEO",
      ],
      {},
    ),
    {
      action: "run",
      env: {
        CI: "true",
        SIM_MOD: path.resolve("scenario.json"),
        SIM_RESPONSES: path.resolve("answers.json"),
        SIM_SEEDS: "0,17",
        SIM_DIFFICULTIES: "Intern,CEO",
      },
    },
  );
  assert.equal(
    parseSimArguments(["--mod", "scenario.json", "--free-fallback"], {}).env
      .SIM_FREE_FALLBACK,
    "1",
  );
  assert.equal(parseSimArguments(["--help"], {}).action, "help");
  assert.equal(parseSimArguments(["--list"], {}).action, "list");
  assert.equal(parseSimArguments([], { SIM_FREE_FALLBACK: "0" }).action, "run");
  assert.equal(
    parseSimArguments(["--mod", "scenario.json"], {
      SIM_ALL: "0",
      SIM_MATRIX: "0",
    }).action,
    "run",
  );
});

test("mod CLI rejects mixed scenario ownership and ambiguous matrices before launching the engine", () => {
  for (const args of [
    ["--scenario", "101"],
    ["--year", "2020"],
    ["--location", "SF"],
    ["--all"],
    ["--matrix"],
    ["--benchmark-stories"],
  ])
    assert.throws(
      () => parseSimArguments(["--mod", "scenario.json", ...args], {}),
      /cannot be combined/,
    );
  assert.throws(
    () =>
      parseSimArguments(
        ["--mod", "scenario.json", "--seed", "1", "--seeds", "2,3"],
        {},
      ),
    /either --seed/,
  );
  assert.throws(
    () =>
      parseSimArguments(
        [
          "--mod",
          "scenario.json",
          "--difficulty",
          "CEO",
          "--difficulties",
          "Intern,CEO",
        ],
        {},
      ),
    /either --difficulty/,
  );
  for (const args of [
    ["--responses", "answers.json"],
    ["--free-fallback"],
    ["--seeds", "1,2"],
    ["--difficulties", "CEO"],
  ])
    assert.throws(() => parseSimArguments(args, {}), /require --mod/);
  assert.throws(() => parseSimArguments(["--mod"], {}), /Missing value/);
  assert.throws(() => parseSimArguments(["--mod", ""], {}), /Missing value/);
  assert.throws(() => parseSimArguments(["--unknown"], {}), /Unknown option/);
  // SIM_* remains an intentional interface, with the same ownership rules as flags.
  assert.throws(
    () => parseSimArguments([], { SIM_MOD: "scenario.json", SIM_YEAR: "2020" }),
    /--year/,
  );
});

test("validation CLI accepts one file and independent JSON/explain modes, rejecting unknown input", () => {
  assert.deepEqual(
    parseValidationArguments(["scenario.json", "--json", "--explain"]),
    {
      file: path.resolve("scenario.json"),
      json: true,
      explain: true,
    },
  );
  assert.equal(parseValidationArguments(["--help"]).help, true);
  assert.throws(() => parseValidationArguments([]), /required/);
  assert.throws(
    () => parseValidationArguments(["one.json", "two.json"]),
    /exactly one/,
  );
  assert.throws(
    () => parseValidationArguments(["scenario.json", "--code"]),
    /Unknown option/,
  );
});

test("public author commands emit clean JSON and execute explicit responses through the game", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-author-cli-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = {
    schemaVersion: 1,
    gameApi: 1,
    id: "public-cli",
    title: "Public CLI",
    creator: "Fixture",
    version: "1",
    description: "Your grid chooses a contribution.",
    seed: 2468,
    baseScenarioId: 999,
    officialArcs: [],
    objectives: {
      mode: "replace",
      items: [
        {
          id: "retire-coal",
          label: "Retire coal",
          metric: "fuelRetirement",
          fuel: "Coal",
          deadlineMonth: 6,
        },
      ],
    },
    scenario: {
      durationMonths: 6,
      startingYear: 2020,
      cash: 1e9,
      startingCustomers: 10000,
      dollarsPerkWh: 0.2,
    },
    choices: [
      {
        id: "funding",
        title: "Funding",
        prompt: "Choose funding.",
        dueMonth: 1,
        options: [
          {
            id: "accept",
            label: "Accept",
            description: "Receive funding.",
            message: "Funding received.",
            grantDollars: 10000,
          },
          {
            id: "decline",
            label: "Decline",
            description: "Keep your plan.",
            message: "Plan kept.",
            costDollars: 0,
          },
        ],
      },
    ],
  };
  const file = path.join(directory, "scenario.json");
  const answers = path.join(directory, "responses.json");
  fs.writeFileSync(file, JSON.stringify(input));
  fs.writeFileSync(
    answers,
    JSON.stringify({
      responses: [{ choiceId: "funding", optionId: "decline" }],
    }),
  );
  const env = { ...process.env, CI: "true" };
  for (const key of Object.keys(env))
    if (key.startsWith("SIM_") || key.startsWith("MODS_VALIDATE_"))
      delete env[key];
  const run = (script, args) =>
    spawnSync(
      process.execPath,
      [path.resolve(__dirname, "..", script), ...args],
      {
        cwd: path.resolve(__dirname, "..", ".."),
        env,
        encoding: "utf8",
      },
    );
  const valid = run("mods-validate.js", [file, "--json"]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stderr, "");
  const report = JSON.parse(valid.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.title, "Public CLI");
  assert(
    report.diagnostics.some((diagnostic) => diagnostic.severity === "warning"),
  );
  assert.deepEqual(Object.keys(report.difficulties).sort(), [
    "CEO",
    "Employee",
    "Intern",
    "Manager",
    "VP",
  ]);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...input, title: 12, runtimeVersion: 999 }),
  );
  const invalid = run("mods-validate.js", [file, "--json"]);
  assert.equal(invalid.status, 1, invalid.stderr);
  const errors = JSON.parse(invalid.stdout).diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  assert(errors.some((diagnostic) => diagnostic.path === "title"));
  assert(errors.some((diagnostic) => diagnostic.path === "runtimeVersion"));
  fs.writeFileSync(file, JSON.stringify(input));
  const explicit = run("sim.js", ["--mod", file, "--responses", answers]);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /seed 2468/);
  assert.match(explicit.stdout, /funding\/decline \(explicit\)/);
  assert.match(explicit.stdout, /Invariants: all passed/);
  fs.writeFileSync(answers, JSON.stringify({ responses: [] }));
  const missing = run("sim.js", ["--mod", file, "--responses", answers]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no response for mod:public-cli:funding/);
});
