#!/usr/bin/env node
/**
 * Runs every pre-handoff check and reports all failures in one pass, the way CI does, instead of
 * stopping at the first. Passing steps print one line; a failing step prints its captured output
 * followed by the command that usually fixes it. See AGENTS.md.
 */
const { spawn } = require("child_process");

const steps = [
  { name: "Types", script: "typecheck" },
  { name: "Lint", script: "lint", fix: "npm run lint:fix" },
  { name: "Formatting", script: "format:check", fix: "npm run format" },
  { name: "Tests", script: "test:ci" },
  { name: "Simulation tests", script: "test:sim" },
  {
    name: "Simulation CLI",
    script: "sim",
    args: ["--", "--scenario", "101", "--months", "12"],
  },
];

function run(step) {
  const started = Date.now();
  return new Promise((resolve) => {
    const args = ["run", "--silent", step.script, ...(step.args || [])];
    const options = { env: { ...process.env, CI: "true", NO_COLOR: "1" } };
    // Windows can only start npm.cmd through a shell, and Node deprecates (DEP0190) passing an
    // argument array alongside `shell`, so it gets one command line. Every argument here is a
    // fixed script name or flag, so nothing needs quoting.
    const child =
      process.platform === "win32"
        ? spawn(["npm", ...args].join(" "), { ...options, shell: true })
        : spawn("npm", args, options);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) =>
      resolve({
        ...step,
        ok: code === 0,
        output,
        seconds: (Date.now() - started) / 1000,
      }),
    );
  });
}

async function main() {
  // The static checks take a few seconds each and barely contend with one another; each Jest run
  // uses every core, so they run alone.
  const results = [...(await Promise.all(steps.slice(0, 3).map(run)))];
  for (const step of steps.slice(3)) {
    results.push(await run(step));
  }
  for (const result of results.filter((r) => !r.ok)) {
    console.error(
      `\n===== ${result.name} failed =====\n${result.output.trimEnd()}`,
    );
  }
  console.error("");
  for (const result of results) {
    const status = result.ok ? "ok  " : "FAIL";
    const hint = !result.ok && result.fix ? `  fix: ${result.fix}` : "";
    console.error(
      `${status} ${result.name.padEnd(18)} ${result.seconds.toFixed(0)}s${hint}`,
    );
  }
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main();
