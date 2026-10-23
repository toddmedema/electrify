#!/usr/bin/env node
/**
 * Runs the headless simulation and prints a report. See src/testing/README.md.
 *
 * The simulation reuses the game's own reducer, so it needs the same environment the app gets:
 * TypeScript, JSX and a DOM. Rather than maintain a second build pipeline for that, this shells
 * out to CRA's jest, pointed at src/testing/SimCli.tsx via --testMatch. That file is named so
 * CRA's default testMatch skips it, which keeps `npm test` free of simulation output.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const FLAGS = {
  "--scenario": "SIM_SCENARIO",
  "--year": "SIM_YEAR",
  "--location": "SIM_LOCATION",
  "--difficulty": "SIM_DIFFICULTY",
  "--months": "SIM_MONTHS",
  "--seed": "SIM_SEED",
  "--strategy": "SIM_STRATEGY",
  "--rate": "SIM_RATE",
  "--build": "SIM_BUILD",
  "--build-mw": "SIM_BUILD_MW",
  "--build-mwh": "SIM_BUILD_MWH",
  "--build-priority": "SIM_BUILD_PRIORITY",
  "--sell-id": "SIM_SELL_ID",
  "--sell-month": "SIM_SELL_MONTH",
  "--mod": "SIM_MOD",
  "--responses": "SIM_RESPONSES",
  "--seeds": "SIM_SEEDS",
  "--difficulties": "SIM_DIFFICULTIES",
};
const BOOLEAN_FLAGS = {
  "--all": "SIM_ALL",
  "--full": "SIM_FULL",
  "--finance": "SIM_FINANCE",
  "--matrix": "SIM_MATRIX",
  "--benchmark-stories": "SIM_STORY_BENCHMARK",
  "--without-stories": "SIM_WITHOUT_STORIES",
  "--without-hazards": "SIM_WITHOUT_HAZARDS",
  "--free-fallback": "SIM_FREE_FALLBACK",
};

const USAGE = `
Runs the game's simulation headlessly and reports what happened.

  npm run sim                              one scenario, default settings
  npm run sim -- --all                     every scenario, one line each
  npm run sim -- --scenario 103 --full     every month of "The Shale Boom"
  npm run sim -- --year 2080 --months 240  a twenty-year run starting in 2080
  npm run sim -- --matrix                 6 scenarios × 5 difficulties × 20 seeds, with/without stories
  npm run sim -- --mod scenario.json --responses responses.json
  npm run sim -- --mod scenario.json --free-fallback --seeds 1,2 --difficulties Employee,Manager

  --scenario <id>        Scenario to play (default 101). --list shows the ids
  --year <n>             Override the scenario's starting year (1980 and up). The cash, rate
                         and fee move from the scenario's era to the requested era. Cash
                         and fee share one era through 2020; the rate follows EIA's historical
                         retail price. An explicit --rate stays at face value
  --location <id>        Override where it's played: any city with downloaded weather
                         (npm run fetch-weather -- --list)
  --difficulty <name>    Intern | Employee | Manager | VP | CEO (default Employee)
  --months <n>           Override the scenario's own duration
  --seed <n>             Pin the run's randomness (default 12345)
  --strategy <name>      none (default) or keepUp, which buys generators when short on supply
  --rate <dollars>       $/kWh charged to customers (default: whatever a real game starts at)
  --build <name>         Build one generator or storage facility immediately
                         (a real recorded player action)
  --build-mw <n>         Generator size for --build in MW (default 300)
  --build-mwh <n>        Storage energy size for --build in MWh
  --build-priority <name> default (normal purchase position) | reserve (last in dispatch)
  --finance              Finance --build instead of paying cash
  --sell-id <n>          Sell one starting facility by facility id
  --sell-month <n>       Wait until this month to apply --sell-id (default 0)
  --all                  Sweep every scenario instead of reporting on one
  --matrix               Run the deterministic story balance matrix
  --benchmark-stories    Compare a 20-year forecast with stories enabled/disabled
  --without-stories      Disable authored story effects for a control run
  --without-hazards      Disable hail and extreme-cold weather hazards for a control run
  --full                 Print every month rather than a sample
  --list                 List the scenarios and exit

  --mod <file>           Play a JSON package with its own seed, setup and term. Cannot combine
                         with --scenario, --year, --location, --all or the story --matrix
  --responses <file>     JSON {"responses":[{"choiceId":"funding","optionId":"accept"}]};
                         add "arc":106 for an imported choice. Missing reached answers fail
  --free-fallback        Explicitly answer unspecified reached choices with their free option
  --seeds <csv>          Compile separate seed variants for a mod (default: the package seed)
  --difficulties <csv>   Mod difficulty matrix, at most 20 combinations with --seeds
`;

function parseSimArguments(args, inherited = process.env) {
  const env = { ...inherited, CI: "true" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { action: "help", env };
    if (arg === "--list") return { action: "list", env };
    if (BOOLEAN_FLAGS[arg]) {
      env[BOOLEAN_FLAGS[arg]] = "1";
      continue;
    }
    if (FLAGS[arg]) {
      const value = args[i + 1];
      if (value === undefined || value === "" || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      env[FLAGS[arg]] = value;
      i++;
      continue;
    }
    throw new Error(`Unknown option ${arg}`);
  }
  if (env.SIM_BUILD_PRIORITY !== undefined) {
    if (!["default", "reserve"].includes(env.SIM_BUILD_PRIORITY))
      throw new Error("--build-priority must be default or reserve.");
    if (!env.SIM_BUILD) throw new Error("--build-priority requires --build.");
  }
  if (env.SIM_MOD) {
    for (const [flag, variable] of Object.entries({
      "--scenario": "SIM_SCENARIO",
      "--year": "SIM_YEAR",
      "--location": "SIM_LOCATION",
      "--all": "SIM_ALL",
      "--matrix": "SIM_MATRIX",
      "--benchmark-stories": "SIM_STORY_BENCHMARK",
    }))
      if (
        ["SIM_ALL", "SIM_MATRIX", "SIM_STORY_BENCHMARK"].includes(variable)
          ? env[variable] === "1"
          : !!env[variable]
      )
        throw new Error(`--mod cannot be combined with ${flag}.`);
    if (env.SIM_SEED !== undefined && env.SIM_SEEDS !== undefined)
      throw new Error("Use either --seed or --seeds, not both.");
    if (env.SIM_DIFFICULTY !== undefined && env.SIM_DIFFICULTIES !== undefined)
      throw new Error("Use either --difficulty or --difficulties, not both.");
    env.SIM_MOD = path.resolve(env.SIM_MOD);
    if (env.SIM_RESPONSES) env.SIM_RESPONSES = path.resolve(env.SIM_RESPONSES);
  } else if (
    env.SIM_RESPONSES ||
    env.SIM_FREE_FALLBACK === "1" ||
    env.SIM_SEEDS ||
    env.SIM_DIFFICULTIES
  )
    throw new Error(
      "--responses, --free-fallback, --seeds and --difficulties require --mod.",
    );
  return { action: "run", env };
}

// Scenarios live in a .tsx file, so pull the ids out with a quick regex rather than a compiler
function requireScenarios() {
  const fs = require("fs");
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "data", "Scenarios.tsx"),
    "utf8",
  );
  const SCENARIOS = [];
  const pattern = /id:\s*(\d+),[\s\S]*?name:\s*"([^"]+)"/g;
  let match = pattern.exec(source);
  while (match) {
    SCENARIOS.push({ id: Number(match[1]), name: match[2] });
    match = pattern.exec(source);
  }
  return { SCENARIOS };
}

// Invoking the binary through node directly, rather than npx, keeps this working the same way
// from cmd, PowerShell and a POSIX shell
function main() {
  let parsed;
  try {
    parsed = parseSimArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 1;
  }
  if (parsed.action === "help") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.action === "list") {
    requireScenarios().SCENARIOS.forEach((scenario) =>
      process.stdout.write(
        `  ${String(scenario.id).padStart(4)}  ${scenario.name}\n`,
      ),
    );
    return 0;
  }
  const result = spawnSync(
    process.execPath,
    [
      // Let Node walk parent module directories. A git worktree may have only CRA's local cache in
      // its own node_modules while sharing the repository's installed dependencies one level up.
      require.resolve("react-scripts/bin/react-scripts.js", {
        paths: [path.resolve(__dirname, "..")],
      }),
      "test",
      "--watchAll=false",
      // The CLI runs one suite; avoid worker startup and the shared OS temporary cache.
      "--runInBand",
      "--cacheDirectory=.tmp/jest-sim-cli",
      "--testMatch",
      "**/src/testing/SimCli.tsx",
    ],
    { stdio: "inherit", env: parsed.env, cwd: path.resolve(__dirname, "..") },
  );
  return result.status === null ? 1 : result.status;
}
if (require.main === module) process.exit(main());
module.exports = { parseSimArguments };
