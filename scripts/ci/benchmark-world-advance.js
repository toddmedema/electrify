// Diagnostic A/B benchmark: same save, real ticks and assertions, warm transforms.
// node scripts/ci/benchmark-world-advance.js <native-world.json> <month> [rounds=3] [requests=9]
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { acquireLease } = require("../dev/coordination");
const { WorldAdvanceWorker } = require("./world-advance");

async function main() {
  const [source, monthText, roundsText = "3", requestsText = "9"] =
    process.argv.slice(2);
  const [month, rounds, requests] = [monthText, roundsText, requestsText].map(
    Number,
  );
  assert(
    source &&
      [month, rounds, requests].every((n) => Number.isSafeInteger(n) && n > 0),
    "Expected a save path, positive month, rounds and request count",
  );
  const lease = await acquireLease("heavy", {
    inherited: process.env.ELECTRIFY_DEVELOPMENT_LEASE,
    onWait: (owner) => console.error(`Waiting for validation in ${owner.cwd}`),
  });
  let directory;
  try {
    await fs.mkdir(".tmp", { recursive: true });
    directory = await fs.mkdtemp(
      path.join(process.cwd(), ".tmp/world-advance-bench-"),
    );
    const input = await fs.readFile(source);
    const file = path.join(directory, "world.json");
    const legacy = () =>
      promisify(execFile)(
        process.execPath,
        [
          require.resolve("react-scripts/bin/react-scripts"),
          "test",
          "--watchAll=false",
          "--runInBand",
          "--testMatch=**/src/testing/WorldAdvanceCli.tsx",
          "--cacheDirectory=.tmp/jest-world-advance",
        ],
        {
          env: {
            ...process.env,
            CI: "true",
            E2E_WORLD_SERVICE: "",
            E2E_WORLD_FILE: file,
            E2E_WORLD_MONTH: String(month),
          },
          windowsHide: true,
          timeout: 150000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    await fs.writeFile(file, input);
    await legacy(); // Warm transforms before either timed variant.
    const digest = async () =>
      createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex");
    const expected = await digest();
    // Exercise a real Jest assertion failure over IPC, then prove the next save is isolated.
    const probe = new WorldAdvanceWorker();
    try {
      await assert.rejects(probe.advance(file, 0), /toBe/);
      await fs.writeFile(file, input);
      await probe.advance(file, month);
      assert.equal(await digest(), expected);
    } finally {
      await probe.close();
    }
    const samples = { oneShotMs: [], persistentMs: [] };
    for (let round = 0; round < rounds; round++) {
      for (const mode of round % 2
        ? ["persistentMs", "oneShotMs"]
        : ["oneShotMs", "persistentMs"]) {
        const worker = new WorldAdvanceWorker();
        const start = performance.now();
        try {
          for (let request = 0; request < requests; request++) {
            await fs.writeFile(file, input);
            if (mode === "oneShotMs") await legacy();
            else await worker.advance(file, month);
            assert.equal(
              await digest(),
              expected,
              `${mode} changed the checkpoint`,
            );
          }
        } finally {
          await worker.close();
        }
        samples[mode].push(Math.round(performance.now() - start));
      }
    }
    const median = (values) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    process.stdout.write(
      JSON.stringify(
        {
          month,
          requests,
          rounds,
          checkpointSha256: expected,
          ...samples,
          speedup: median(samples.oneShotMs) / median(samples.persistentMs),
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    lease.release();
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
