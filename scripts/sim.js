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
  "--sell-id": "SIM_SELL_ID",
  "--sell-month": "SIM_SELL_MONTH",
};
const BOOLEAN_FLAGS = {
  "--all": "SIM_ALL",
  "--full": "SIM_FULL",
  "--finance": "SIM_FINANCE",
  "--matrix": "SIM_MATRIX",
  "--benchmark-stories": "SIM_STORY_BENCHMARK",
  "--without-stories": "SIM_WITHOUT_STORIES",
};

const USAGE = `
Runs the game's simulation headlessly and reports what happened.

  npm run sim                              one scenario, default settings
  npm run sim -- --all                     every scenario, one line each
  npm run sim -- --scenario 103 --full     every month of "The Shale Boom"
  npm run sim -- --year 2080 --months 240  a twenty-year run starting in 2080
  npm run sim -- --matrix                 6 scenarios × 5 difficulties × 20 seeds, with/without stories

  --scenario <id>        Scenario to play (default 101). --list shows the ids
  --year <n>             Override the scenario's starting year (1980 and up)
  --location <id>        Override where it's played: any city with downloaded weather
                         (npm run fetch-weather -- --list)
  --difficulty <name>    Intern | Employee | Manager | VP | CEO (default Employee)
  --months <n>           Override the scenario's own duration
  --seed <n>             Pin the run's randomness (default 12345)
  --strategy <name>      none (default) or keepUp, which buys generators when short on supply
  --rate <dollars>       $/kWh charged to customers (default: whatever a real game starts at)
  --build <name>         Build one generator immediately (a real recorded player action)
  --build-mw <n>         Size for --build in MW (default 300)
  --finance              Finance --build instead of paying cash
  --sell-id <n>          Sell one starting facility by facility id
  --sell-month <n>       Wait until this month to apply --sell-id (default 0)
  --all                  Sweep every scenario instead of reporting on one
  --matrix               Run the deterministic story balance matrix
  --benchmark-stories    Compare a 20-year forecast with stories enabled/disabled
  --without-stories      Disable authored story effects for a control run
  --full                 Print every month rather than a sample
  --list                 List the scenarios and exit
`;

const args = process.argv.slice(2);
const env = { ...process.env, CI: "true" };

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (arg === "--list") {
    // Reading the scenarios needs the TS/JSX pipeline, so ask the simulation runner for them
    const { SCENARIOS } = requireScenarios();
    SCENARIOS.forEach((s) =>
      process.stdout.write(`  ${String(s.id).padStart(4)}  ${s.name}\n`),
    );
    process.exit(0);
  }
  if (BOOLEAN_FLAGS[arg]) {
    env[BOOLEAN_FLAGS[arg]] = "1";
    continue;
  }
  if (FLAGS[arg]) {
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      process.stderr.write(`Missing value for ${arg}\n`);
      process.exit(1);
    }
    env[FLAGS[arg]] = value;
    i++;
    continue;
  }
  process.stderr.write(`Unknown option ${arg}\n${USAGE}`);
  process.exit(1);
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
    "--testMatch",
    "**/src/testing/SimCli.tsx",
  ],
  { stdio: "inherit", env, cwd: path.resolve(__dirname, "..") },
);

process.exit(result.status === null ? 1 : result.status);
