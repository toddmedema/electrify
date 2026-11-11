const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { run, cleanText, ghRunner } = require("../dev/pr-triage");

// Local noon, so the local-date comparison for --expires is the same in every time zone.
const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;
const script = path.resolve("scripts/dev/pr-triage.js");

const check = (name, status = "COMPLETED", conclusion = "SUCCESS") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
});
const statusContext = (context, state) => ({
  __typename: "StatusContext",
  context,
  state,
});
const comment = (id, login, body) => ({
  databaseId: id,
  author: { login },
  body,
});
const thread = (id, over = {}, login = "coderabbitai") => ({
  isResolved: false,
  isOutdated: false,
  path: "src/a.ts",
  line: 12,
  comments: {
    nodes: [comment(id, login, "**Potential issue**\n\nGuard the null case.")],
  },
  ...over,
});
const withChecks = (...nodes) => ({
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: { pageInfo: { hasNextPage: false }, nodes },
          },
        },
      },
    ],
  },
});
const page = (nodes) => ({ pageInfo: { hasPreviousPage: false }, nodes });
const pr = (number, over = {}) => ({
  number,
  title: `PR ${number}`,
  isDraft: false,
  headRefName: `branch-${number}`,
  headRefOid: String(number).padEnd(40, "a"),
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  ...withChecks(check("lint")),
  reviewThreads: page([]),
  comments: page([]),
  reviews: page([]),
  ...over,
});
const failing = (...names) =>
  withChecks(...names.map((n) => check(n, "COMPLETED", "FAILURE")));
const outsideDiff = (count, style = ": ") =>
  `<!-- coderabbit-ai-generated:v1 -->\n**Actionable comments posted: 1**\n<details>\n<summary>Outside diff range comments${style}${count}${style === " (" ? ")" : ""}</summary>\n\n` +
  "`src/b.ts` `40-44`: **Handle the empty list.**\n\nThe loop assumes one item.\n</details>";
const walkthrough =
  "<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n## Walkthrough\nChanges the chart.\n";

function harness(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-triage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const file = (name) => path.join(directory, name);
  const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
  const triage = (prs, args = [], now = NOW) =>
    run(["--state-dir", directory, ...args], {
      now,
      runGh: (ghArgs) => {
        calls.push(ghArgs);
        return JSON.stringify({
          data: {
            repository: {
              pullRequests: { pageInfo: { hasNextPage: false }, nodes: prs },
            },
          },
        });
      },
    });
  const list = (result) => JSON.parse(result.stdout);
  return { directory, calls, file, read, triage, list };
}

test("a clean repository prints one line, writes nothing and leaves no lock", (t) => {
  const h = harness(t);
  const result = h.triage([pr(1), pr(2)]);
  assert.deepEqual([result.code, result.stdout], [0, "CLEAN 2 open PRs"]);
  assert.deepEqual(fs.readdirSync(h.directory), []);
  assert.equal(h.calls.length, 1, "one gh call surveys every PR");
});

test("only failed, timed-out, startup-failed and action-required checks fail a PR", (t) => {
  const h = harness(t);
  const conclusions = [
    ["a", "FAILURE"],
    ["b", "TIMED_OUT"],
    ["c", "STARTUP_FAILURE"],
    ["d", "ACTION_REQUIRED"],
    ["e", "CANCELLED"],
    ["f", "SKIPPED"],
    ["g", "NEUTRAL"],
    ["h", "SUCCESS"],
  ];
  const result = h.triage([
    pr(1, withChecks(...conclusions.map(([n, c]) => check(n, "COMPLETED", c)))),
    pr(
      2,
      withChecks(
        statusContext("ci/x", "FAILURE"),
        statusContext("ci/y", "ERROR"),
      ),
    ),
    pr(
      3,
      withChecks(
        statusContext("ci/x", "SUCCESS"),
        check("e", "COMPLETED", "CANCELLED"),
      ),
    ),
  ]);
  const { work } = h.list(result);
  assert.deepEqual(
    work.map((item) => [item.number, item.reasons]),
    [
      [1, [{ type: "ci", checks: ["a", "b", "c", "d"] }]],
      [2, [{ type: "ci", checks: ["ci/x", "ci/y"] }]],
    ],
  );
  assert.deepEqual(work[0], {
    number: 1,
    title: "PR 1",
    branch: "branch-1",
    headSha: "1".padEnd(40, "a"),
    draft: false,
    reasons: work[0].reasons,
  });
});

test("failed checks wait until every other check has finished", (t) => {
  const h = harness(t);
  const mixed = withChecks(
    check("a", "COMPLETED", "FAILURE"),
    check("b", "IN_PROGRESS", null),
  );
  assert.equal(h.triage([pr(1, mixed)]).stdout, "CLEAN 1 open PRs");
  const queued = withChecks(
    check("a", "COMPLETED", "FAILURE"),
    statusContext("ci/x", "PENDING"),
  );
  assert.equal(h.triage([pr(1, queued)]).stdout, "CLEAN 1 open PRs");
  assert.equal(h.list(h.triage([pr(1, failing("a"))])).work.length, 1);
});

test("conflicts count when CONFLICTING or DIRTY, not while GitHub is still computing", (t) => {
  const h = harness(t);
  const result = h.triage([
    pr(1, { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    pr(2, { mergeable: "MERGEABLE", mergeStateStatus: "DIRTY" }),
    pr(3, { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    pr(4, { mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED" }),
  ]);
  const { work } = h.list(result);
  assert.deepEqual(
    work.map((item) => [item.number, item.reasons]),
    [
      [1, [{ type: "conflict" }]],
      [2, [{ type: "conflict" }]],
    ],
  );
});

test("CodeRabbit feedback: unresolved current threads and outside-diff sections, nothing else", (t) => {
  const h = harness(t);
  const feedback = () =>
    pr(1, {
      reviewThreads: page([
        thread(10),
        thread(11, { isResolved: true }),
        thread(12, { isOutdated: true }),
        thread(13, {}, "toddmedema"),
        thread(14, { path: "docs/x.md", line: null }, "coderabbitai[bot]"),
        thread(101),
      ]),
      comments: page([
        comment(20, "coderabbitai", walkthrough),
        comment(21, "toddmedema", outsideDiff(2)),
      ]),
      reviews: page([
        comment(30, "coderabbitai", outsideDiff(2)),
        comment(31, "coderabbitai", outsideDiff(3, " (")),
        comment(32, "coderabbitai", outsideDiff(0)),
        comment(33, "coderabbitai", "Nitpick comments: 4\nTrivial · Low value"),
        comment(
          34,
          "coderabbitai",
          "**Actionable comments posted: 2**\n(the findings are inline threads)",
        ),
        comment(35, "toddmedema", ""),
      ]),
    });
  fs.writeFileSync(
    h.file("state.json"),
    JSON.stringify({
      1: { attempts: 0, needsHumanSha: null, handledCommentIds: [101] },
    }),
  );
  const [reason] = h.list(h.triage([feedback()])).work[0].reasons;
  assert.equal(reason.type, "coderabbit");
  assert.deepEqual(
    reason.comments.map(({ id, kind, where }) => [id, kind, where]),
    [
      [10, "thread", "src/a.ts:12"],
      [14, "thread", "docs/x.md"],
      [30, "review", "outside diff range (2)"],
      [31, "review", "outside diff range (3)"],
    ],
  );
  assert.equal(
    reason.comments[0].excerpt,
    "Potential issue Guard the null case.",
  );
  assert.match(reason.comments[2].excerpt, /Handle the empty list/);
});

test("nitpick-only reviews are work only with --nitpicks", (t) => {
  const h = harness(t);
  const nitpicks = pr(1, {
    reviews: page([
      comment(
        40,
        "coderabbitai",
        "<details><summary> Nitpick comments: 3</summary>\n`1-2`: **Trivial**\n</details>",
      ),
    ]),
  });
  assert.equal(h.triage([nitpicks]).stdout, "CLEAN 1 open PRs");
  const [reason] = h.list(h.triage([nitpicks], ["--nitpicks"])).work[0].reasons;
  assert.deepEqual(
    reason.comments.map(({ id, where }) => [id, where]),
    [[40, "nitpicks (3)"]],
  );
});

test("a run with work holds the lock; --finish records attempts and comment IDs and releases it", (t) => {
  const h = harness(t);
  const prs = () => [
    pr(1, failing("check")),
    pr(2, { reviewThreads: page([thread(50)]) }),
    pr(3, { ...failing("check"), reviewThreads: page([thread(60)]) }),
  ];
  const first = h.triage(prs());
  assert.deepEqual(
    h.list(first).work.map((item) => item.number),
    [1, 2, 3],
  );
  assert.equal(fs.existsSync(h.file("lock")), true);
  assert.equal(h.triage(prs()).stdout, "SKIPPED previous run in flight");
  assert.equal(h.calls.length, 1, "a skipped run never calls gh");

  assert.equal(
    run(["--state-dir", h.directory, "--finish"]).stdout,
    "FINISHED 3 PRs recorded",
  );
  assert.equal(fs.existsSync(h.file("lock")), false);
  assert.equal(fs.existsSync(h.file("pending.json")), false);
  assert.deepEqual(h.read("state.json"), {
    1: { attempts: 1, needsHumanSha: null, handledCommentIds: [] },
    2: { attempts: 0, needsHumanSha: null, handledCommentIds: [50] },
    3: { attempts: 1, needsHumanSha: null, handledCommentIds: [60] },
  });

  // Handled feedback is not offered again, but a PR that still fails CI is.
  const second = h.list(h.triage(prs()));
  assert.deepEqual(
    second.work.map((item) => item.number),
    [1, 3],
  );
  assert.deepEqual(second.work[1].reasons, [{ type: "ci", checks: ["check"] }]);
});

test("--finish without a pending list only releases the lock", (t) => {
  const h = harness(t);
  fs.writeFileSync(h.file("lock"), "1");
  assert.equal(
    run(["--state-dir", h.directory, "--finish"]).stdout,
    "FINISHED 0 PRs recorded",
  );
  assert.deepEqual(fs.readdirSync(h.directory), []);
});

test("a PR that keeps failing is flagged for a human after three attempts, then left alone", (t) => {
  const h = harness(t);
  const sha = "7".padEnd(40, "a");
  fs.writeFileSync(
    h.file("state.json"),
    JSON.stringify({
      7: { attempts: 3, needsHumanSha: null, handledCommentIds: [] },
      baselineAt: "keep me",
    }),
  );
  const flagged = h.triage([pr(7, failing("check"))]);
  assert.equal(
    flagged.stdout,
    "CLEAN 1 open PRs; needs human: #7 (ci still failing after 3 attempts)",
  );
  assert.equal(h.read("state.json")[7].needsHumanSha, sha);
  assert.equal(
    h.read("state.json").baselineAt,
    "keep me",
    "unknown keys survive",
  );
  assert.equal(h.triage([pr(7, failing("check"))]).stdout, "CLEAN 1 open PRs");

  // A push by anyone moves the head: the cap resets and the PR is eligible again.
  const pushed = h.triage([
    pr(7, { ...failing("check"), headRefOid: "b".repeat(40) }),
  ]);
  assert.equal(h.list(pushed).work[0].number, 7);
  assert.deepEqual(h.read("state.json")[7].attempts, 0);
  assert.equal(h.read("state.json")[7].needsHumanSha, null);
});

test("a flagged PR that turns green on the same commit is eligible again when a conflict appears", (t) => {
  const h = harness(t);
  const sha = "7".padEnd(40, "a");
  fs.writeFileSync(
    h.file("state.json"),
    JSON.stringify({
      7: { attempts: 3, needsHumanSha: sha, handledCommentIds: [] },
    }),
  );
  // Still failing on the flagged commit: left alone.
  assert.equal(h.triage([pr(7, failing("check"))]).stdout, "CLEAN 1 open PRs");
  // A person re-ran CI and it passed: the flag and the attempts are cleared.
  assert.equal(h.triage([pr(7)]).stdout, "CLEAN 1 open PRs");
  assert.deepEqual(h.read("state.json")[7], {
    attempts: 0,
    needsHumanSha: null,
    handledCommentIds: [],
  });
  // The base moved, the head did not: this is new work.
  const { work } = h.list(
    h.triage([pr(7, { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" })]),
  );
  assert.deepEqual(work[0].reasons, [{ type: "conflict" }]);
});

test("attempts reset when CI is fully green and conflict-free, not while unknown or pending", (t) => {
  const h = harness(t);
  const seed = (n) => ({
    attempts: 2,
    needsHumanSha: null,
    handledCommentIds: [n],
  });
  fs.writeFileSync(
    h.file("state.json"),
    JSON.stringify({ 1: seed(1), 2: seed(2), 3: seed(3) }),
  );
  h.triage([
    pr(1),
    pr(2, { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }),
    pr(3, withChecks(check("a", "IN_PROGRESS", null))),
  ]);
  const state = h.read("state.json");
  assert.deepEqual(
    [1, 2, 3].map((n) => state[n].attempts),
    [0, 2, 2],
  );
  assert.deepEqual(state[1].handledCommentIds, [1]);
});

test("at most --max-work PRs are listed; the rest are queued and not recorded", (t) => {
  const h = harness(t);
  const prs = [1, 2, 3, 4, 5].map((n) => pr(n, failing("check")));
  const result = h.list(h.triage(prs));
  assert.deepEqual(
    result.work.map((item) => item.number),
    [1, 2, 3],
  );
  assert.deepEqual(result.queued, [4, 5]);
  run(["--state-dir", h.directory, "--finish"]);
  const state = h.read("state.json");
  assert.deepEqual(Object.keys(state), ["1", "2", "3"]);
  assert.deepEqual(
    h.list(h.triage(prs, ["--max-work", "1"])).queued,
    [2, 3, 4, 5],
  );
});

test("the lock expires after 90 minutes and accepts epoch seconds or milliseconds", (t) => {
  const h = harness(t);
  const lock = h.file("lock");
  fs.writeFileSync(lock, String(Math.floor((NOW - 89 * MINUTE) / 1000)));
  assert.equal(h.triage([pr(1)]).stdout, "SKIPPED previous run in flight");
  fs.writeFileSync(lock, String(NOW - 89 * MINUTE));
  assert.equal(h.triage([pr(1)]).stdout, "SKIPPED previous run in flight");
  fs.writeFileSync(lock, String(Math.floor((NOW - 91 * MINUTE) / 1000)));
  assert.equal(h.triage([pr(1)]).stdout, "CLEAN 1 open PRs");
  assert.equal(
    fs.existsSync(lock),
    false,
    "a clean run releases the lock it took",
  );
});

test("past --expires nothing is fetched or locked", (t) => {
  const h = harness(t);
  assert.equal(
    h.triage([pr(1)], ["--expires", "2026-11-10"]).stdout,
    "EXPIRED 2026-11-10",
  );
  assert.equal(h.calls.length, 0);
  assert.deepEqual(fs.readdirSync(h.directory), []);
  assert.equal(
    h.triage([pr(1)], ["--expires", "2026-11-11"]).stdout,
    "CLEAN 1 open PRs",
  );
});

test("--dry-run reads only: no lock, state or pending file, and it ignores a held lock", (t) => {
  const h = harness(t);
  fs.writeFileSync(h.file("lock"), String(Math.floor(NOW / 1000)));
  // PR 3 is green, so a real run would reset its attempts and rewrite this file.
  const seeded = JSON.stringify({
    3: { attempts: 2, needsHumanSha: null, handledCommentIds: [] },
  });
  fs.writeFileSync(h.file("state.json"), seeded);
  const before = fs.readdirSync(h.directory);
  const result = h.triage(
    [pr(1, failing("check")), pr(2, { mergeable: "CONFLICTING" }), pr(3)],
    ["--dry-run", "--explain"],
  );
  assert.deepEqual(
    h.list(result).work.map((item) => item.number),
    [1, 2],
  );
  assert.match(result.stderr.join("\n"), /#1 .* failed=1 .* -> ci/);
  assert.deepEqual(fs.readdirSync(h.directory), before);
  assert.equal(fs.readFileSync(h.file("state.json"), "utf8"), seeded);
});

test("errors print one ERROR line, release the lock and leave state untouched", (t) => {
  const h = harness(t);
  const failed = run(["--state-dir", h.directory], {
    now: NOW,
    runGh: () => {
      throw new Error("gh api failed: HTTP 502");
    },
  });
  assert.deepEqual(
    [failed.code, failed.stdout],
    [1, "ERROR gh api failed: HTTP 502"],
  );
  assert.deepEqual(fs.readdirSync(h.directory), []);

  fs.writeFileSync(h.file("state.json"), "{not json");
  const corrupt = h.triage([pr(1)]);
  assert.equal(corrupt.code, 1);
  assert.match(corrupt.stdout, /^ERROR .*state\.json is not valid JSON/);
  assert.equal(fs.readFileSync(h.file("state.json"), "utf8"), "{not json");
  assert.equal(fs.existsSync(h.file("lock")), false);

  assert.match(run(["--bogus"]).stdout, /^ERROR Unknown option --bogus/);
  assert.match(
    run(["--expires", "tomorrow"]).stdout,
    /^ERROR --expires takes a date/,
  );
});

test("a GraphQL error response is an ERROR, not an empty repository", (t) => {
  const h = harness(t);
  const result = run(["--state-dir", h.directory], {
    now: NOW,
    runGh: () =>
      JSON.stringify({ errors: [{ message: "Resource limits exceeded" }] }),
  });
  assert.deepEqual(
    [result.code, result.stdout],
    [1, "ERROR GraphQL: Resource limits exceeded"],
  );
  assert.deepEqual(fs.readdirSync(h.directory), []);
});

test("truncated lists are reported on stderr, never in the verdict", (t) => {
  const h = harness(t);
  const capped = pr(1, {
    reviewThreads: { pageInfo: { hasPreviousPage: true }, nodes: [] },
  });
  const result = run(["--state-dir", h.directory, "--dry-run"], {
    now: NOW,
    runGh: () =>
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: true },
              nodes: [capped],
            },
          },
        },
      }),
  });
  assert.equal(result.stdout, "CLEAN 1 open PRs");
  assert.deepEqual(result.stderr, [
    "warning: more than 100 open PRs; only the oldest 100 were checked",
    "warning: #1: only the newest 100 review threads",
  ]);
});

test("--finish releases the lock even when the pending record is unreadable", (t) => {
  const h = harness(t);
  fs.writeFileSync(h.file("lock"), "1");
  fs.writeFileSync(h.file("pending.json"), "{truncated");
  const result = run(["--state-dir", h.directory, "--finish"]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^ERROR .*pending\.json is not valid JSON/);
  assert.equal(fs.existsSync(h.file("lock")), false);
});

test(
  "a hung gh fails the run with ERROR and releases the lock instead of holding it for 90 minutes",
  { skip: process.platform === "win32" },
  (t) => {
    const h = harness(t);
    const bin = path.join(h.directory, "bin");
    fs.mkdirSync(bin);
    // `exec` so the kill lands on the sleeping process itself, not a shell around it.
    fs.writeFileSync(path.join(bin, "gh"), "#!/bin/sh\nexec sleep 30\n", {
      mode: 0o755,
    });
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
    t.after(() => {
      process.env.PATH = originalPath;
    });
    const started = Date.now();
    const result = run(["--state-dir", h.directory], {
      now: NOW,
      runGh: ghRunner("octo/widgets", 1000),
    });
    assert.deepEqual(
      [result.code, result.stdout],
      [1, "ERROR gh api timed out after 1s"],
    );
    assert.ok(Date.now() - started < 10_000, "the hung gh was killed");
    assert.deepEqual(fs.readdirSync(h.directory), ["bin"]);
  },
);

test("excerpts drop markup, links and comments and stay short", () => {
  const text = cleanText(
    '<!-- hidden --><picture><img alt="x" src="https://e/x.png"/></picture> **Bold** <b>tag</b> see https://example.com/a  now ' +
      "word ".repeat(200),
    60,
  );
  assert.equal(text.length, 60);
  assert.match(text, /^Bold tag see now word/);
  assert.match(text, /…$/);
});

test(
  "the CLI asks gh once, for the right repository, and prints the verdict",
  { skip: process.platform === "win32" },
  (t) => {
    const h = harness(t);
    const bin = path.join(h.directory, "bin");
    fs.mkdirSync(bin);
    const fixture = path.join(h.directory, "response.json");
    fs.writeFileSync(
      fixture,
      JSON.stringify({
        data: {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false },
              nodes: [pr(1, failing("check"))],
            },
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(bin, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${h.directory}/args.txt"\necho "$GH_REPO" > "${h.directory}/repo.txt"\ncat "${fixture}"\n`,
      { mode: 0o755 },
    );
    const state = path.join(h.directory, "state");
    const result = spawnSync(
      process.execPath,
      [script, "--repo", "octo/widgets", "--state-dir", state],
      {
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).work[0].number, 1);
    const args = fs
      .readFileSync(path.join(h.directory, "args.txt"), "utf8")
      .split("\n");
    assert.deepEqual(args.slice(0, 6), [
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "repo={repo}",
    ]);
    assert.match(
      args.join("\n"),
      /statusCheckRollup[\s\S]*reviewThreads[\s\S]*reviews/,
    );
    assert.equal(
      fs.readFileSync(path.join(h.directory, "repo.txt"), "utf8").trim(),
      "octo/widgets",
    );
    assert.equal(fs.existsSync(path.join(state, "lock")), true);

    const done = spawnSync(
      process.execPath,
      [script, "--finish", "--state-dir", state],
      {
        encoding: "utf8",
      },
    );
    assert.equal(done.stdout.trim(), "FINISHED 1 PRs recorded");
    assert.equal(fs.existsSync(path.join(state, "lock")), false);
  },
);
