const { test } = require("node:test");
const assert = require("node:assert/strict");
const { names, route, complete, waitForNativeJobs } = require("./wait-native");
const passed = () =>
  names.map((name, index) => ({
    name,
    id: index + 1,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
  }));

test("fan-in waits for all three native workers and ignores its own running check", () => {
  assert(complete([...passed(), { name: "check", status: "in_progress" }]));
  assert.equal(complete(passed().slice(1)), false);
  assert.equal(
    complete(
      passed().map((job, index) =>
        index ? job : { ...job, status: "in_progress", conclusion: null },
      ),
    ),
    false,
  );
  assert.throws(
    () => complete([...passed(), { ...passed()[0], id: 99 }]),
    /Duplicate/,
  );
});

test("failed, cancelled, skipped and timed-out native workers never pass the gate", () => {
  for (const conclusion of [
    "failure",
    "cancelled",
    "skipped",
    "timed_out",
    "neutral",
  ])
    assert.throws(
      () =>
        complete(
          passed().map((job, index) => (index ? job : { ...job, conclusion })),
        ),
      /did not pass/,
    );
});

test("native status is pinned to the current run, including all rerun attempts", () => {
  assert.equal(
    route({
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "2",
    }),
    "repos/owner/repo/actions/runs/123/jobs?filter=all&per_page=100",
  );
  assert.throws(() => route({ GITHUB_REPOSITORY: "owner/repo" }), /run ID/);
});

test("partial reruns reuse unchanged jobs but never a superseded passing result", () => {
  const newer = { ...passed()[0], id: 99, run_attempt: 2 };
  assert.equal(
    complete([...passed(), { ...newer, status: "queued", conclusion: null }]),
    false,
  );
  assert.throws(
    () => complete([...passed(), { ...newer, conclusion: "failure" }]),
    /did not pass/,
  );
  assert(complete([...passed(), newer]));
  assert(complete([newer, ...passed()]));
});

test("fan-in retries unavailable metadata and fails closed on timeout or persistent errors", async () => {
  let clock = 0,
    calls = 0;
  const options = {
    timeout: 50,
    interval: 10,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  };
  await waitForNativeJobs(async () => {
    if (++calls === 1) throw new Error("temporary");
    return calls === 2 ? [] : passed();
  }, options);
  assert.equal(calls, 3);
  await assert.rejects(
    waitForNativeJobs(async () => [], options),
    /Timed out/,
  );
  await assert.rejects(
    waitForNativeJobs(async () => {
      throw new Error("unavailable");
    }, options),
    /Unable to read/,
  );
});
