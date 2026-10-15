const { execFileSync } = require("node:child_process");

const names = [
  "Linux x64 tests",
  "Windows x64 tests",
  "macOS Apple Silicon tests",
  "macOS Intel tests",
];

function route(env) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || "") ||
    !/^\d+$/.test(env.GITHUB_RUN_ID || "")
  )
    throw new Error("Native status requires this repository and run ID");
  return `repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/jobs?filter=all&per_page=100`;
}

function complete(jobs) {
  const latest = new Map();
  for (const job of jobs.filter((job) => names.includes(job.name))) {
    const previous = latest.get(job.name);
    if (
      previous &&
      previous.run_attempt === job.run_attempt &&
      previous.id !== job.id
    )
      throw new Error("Duplicate native job names in one attempt");
    if (!previous || job.run_attempt >= previous.run_attempt)
      latest.set(job.name, job);
  }
  const native = [...latest.values()];
  if (
    native.length !== names.length ||
    native.some((job) => job.status !== "completed" || !job.conclusion)
  )
    return false;
  const failed = native.filter((job) => job.conclusion !== "success");
  if (failed.length)
    throw new Error(
      `Native jobs did not pass: ${failed.map((job) => `${job.name}: ${job.conclusion}`).join(", ")}`,
    );
  return true;
}

async function waitForNativeJobs(
  fetchJobs,
  {
    timeout = 30 * 60_000,
    interval = 10_000,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  const deadline = now() + timeout;
  let errors = 0;
  while (now() < deadline) {
    let jobs;
    try {
      jobs = await fetchJobs();
      errors = 0;
    } catch (error) {
      if (++errors >= 3)
        throw new Error(`Unable to read native status: ${error.message}`);
      console.error("Native status temporarily unavailable; retrying.");
      await sleep(interval);
      continue;
    }
    if (complete(jobs)) {
      console.error(
        "All four native workers passed in this run's latest job attempts.",
      );
      return;
    }
    await sleep(interval);
  }
  throw new Error("Timed out waiting for all four native workers");
}

if (require.main === module) {
  const endpoint = route(process.env);
  waitForNativeJobs(() =>
    JSON.parse(
      execFileSync("gh", ["api", "--paginate", "--slurp", endpoint], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 10e6,
      }),
    ).flatMap((page) => page.jobs),
  ).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { names, route, complete, waitForNativeJobs };
