const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { run, summarizeChecks } = require("../dev/pr-triage");

const page = (nodes = [], endCursor = null) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});
const feedback = (
  id,
  login = "toddmedema",
  updatedAt = "2026-11-11T12:00:00Z",
) => ({
  id,
  author: { login },
  updatedAt,
});
const thread = (id, overrides = {}) => ({
  id,
  path: "src/a.ts",
  line: 12,
  isResolved: false,
  isOutdated: false,
  comments: page([feedback(`comment-${id}`)]),
  ...overrides,
});
const check = (id, overrides = {}) => ({
  __typename: "CheckRun",
  id,
  name: id,
  status: "COMPLETED",
  conclusion: "SUCCESS",
  startedAt: "2026-11-11T12:00:00Z",
  completedAt: "2026-11-11T12:01:00Z",
  ...overrides,
});
const pr = (number, overrides = {}) => ({
  id: `pr-${number}`,
  number,
  url: `https://github.com/toddmedema/electrify/pull/${number}`,
  isDraft: false,
  headRefName: `branch-${number}`,
  headRefOid: `head-${number}`,
  baseRefOid: "base",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  commits: {
    nodes: [
      {
        commit: {
          id: `commit-${number}`,
          oid: `head-${number}`,
          statusCheckRollup: {
            state: "SUCCESS",
            contexts: page([check("unit")]),
          },
        },
      },
    ],
  },
  reviewThreads: page(),
  comments: page(),
  reviews: page(),
  ...overrides,
});
const repository = (prs, cursor = null) => ({
  repository: {
    nameWithOwner: "toddmedema/electrify",
    pullRequests: page(prs, cursor),
  },
});

function harness(
  first,
  next = () => assert.fail("unexpected follow-up request"),
) {
  const calls = [];
  const runGh = (args) => {
    assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
    const values = Object.fromEntries(
      args
        .filter((_, i) => args[i - 1] === "-f")
        .map((value) => {
          const index = value.indexOf("=");
          return [value.slice(0, index), value.slice(index + 1)];
        }),
    );
    assert.doesNotMatch(
      values.query,
      /\bbody\b|\bdatabaseId\b|\bmutation\b/,
      "polling uses metadata and opaque GraphQL IDs only",
    );
    calls.push(values);
    return JSON.stringify({ data: calls.length === 1 ? first : next(values) });
  };
  return {
    calls,
    execute: () => run(["--repo", "toddmedema/electrify"], { runGh }),
  };
}

test("a quiet repository produces compact metadata in one request", () => {
  const h = harness(repository([pr(1), pr(2)]));
  const result = h.execute();
  assert.equal(result.code, 0);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.repository, "toddmedema/electrify");
  assert.equal(snapshot.prs.length, 2);
  assert.deepEqual(snapshot.prs[0], {
    number: 1,
    url: pr(1).url,
    branch: "branch-1",
    draft: false,
    headSha: "head-1",
    baseSha: "base",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    ci: { state: "SUCCESS", failed: [], pending: [] },
    threads: [],
    comments: [],
    reviews: [],
  });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    [h.calls[0].owner, h.calls[0].repo],
    ["toddmedema", "electrify"],
  );
});

test("CI distinguishes failures from pending, cancelled and skipped checks", () => {
  const failed = [
    "FAILURE",
    "TIMED_OUT",
    "STARTUP_FAILURE",
    "ACTION_REQUIRED",
  ].map((conclusion) => check(conclusion, { conclusion }));
  const pending = [
    check("queued", { status: "QUEUED", conclusion: null }),
    check("running", { status: "IN_PROGRESS", conclusion: null }),
  ];
  for (const state of ["FAILURE", "ERROR", "PENDING", "EXPECTED"]) {
    const item = {
      __typename: "StatusContext",
      id: state,
      context: state,
      state,
      createdAt: "now",
    };
    (["FAILURE", "ERROR"].includes(state) ? failed : pending).push(item);
  }
  const ignored = ["SUCCESS", "NEUTRAL", "CANCELLED", "SKIPPED"].map(
    (conclusion) => check(conclusion, { conclusion }),
  );
  assert.deepEqual(
    summarizeChecks([...failed, ...pending, ...ignored], "FAILURE"),
    { state: "FAILURE", failed, pending },
  );
});

test("reports both matching authors, edits, and outdated unresolved threads without deciding actionability", () => {
  const item = pr(1, {
    reviewThreads: page([
      thread("resolved", { isResolved: true }),
      thread("outdated", { isOutdated: true }),
      thread("rabbit", {
        comments: page([feedback("bot", "coderabbitai[bot]")]),
      }),
      thread("other-root", {
        comments: page([feedback("other", "someone"), feedback("reply")]),
      }),
      thread("unrelated", { comments: page([feedback("other", "someone")]) }),
    ]),
    comments: page([
      feedback("user"),
      feedback("bot", "coderabbitai"),
      feedback("other", "someone"),
      { ...feedback("deleted"), author: null },
    ]),
    reviews: page([
      feedback("review", "coderabbitai[bot]"),
      feedback("edited", "toddmedema", "later"),
    ]),
  });
  const result = harness(repository([item])).execute();
  assert.equal(result.code, 0);
  const [snapshot] = JSON.parse(result.stdout).prs;
  assert.deepEqual(
    snapshot.threads.map(({ id }) => id),
    ["outdated", "rabbit", "other-root"],
  );
  assert.equal(snapshot.threads[0].outdated, true);
  assert.equal(snapshot.threads[2].comments[0].id, "reply");
  assert.deepEqual(
    snapshot.comments.map(({ id }) => id),
    ["user", "bot"],
  );
  assert.equal(snapshot.reviews[1].updatedAt, "later");
});

test("paginates PRs, checks, threads, thread replies, comments and reviews", () => {
  const item = pr(1);
  item.commits.nodes[0].commit.statusCheckRollup.contexts = page(
    Array.from({ length: 100 }, (_, i) => check(`success-${i}`)),
    "checks-next",
  );
  item.comments = page(
    Array.from({ length: 100 }, (_, i) => feedback(`other-${i}`, "other")),
    "comments-next",
  );
  item.reviews = page(
    Array.from({ length: 100 }, (_, i) => feedback(`review-${i}`, "other")),
    "reviews-next",
  );
  item.reviewThreads = page(
    Array.from({ length: 100 }, (_, i) =>
      thread(`resolved-${i}`, { isResolved: true }),
    ),
    "threads-next",
  );
  const lateThread = thread("late", {
    comments: page(
      Array.from({ length: 10 }, (_, i) => feedback(`reply-${i}`, "other")),
      "replies-next",
    ),
  });
  const routes = {
    "prs-next": repository([pr(21)]),
    "checks-next": {
      node: {
        statusCheckRollup: {
          contexts: page([check("failed-late", { conclusion: "FAILURE" })]),
        },
      },
    },
    "threads-next": { node: { reviewThreads: page([lateThread]) } },
    "replies-next": { node: { comments: page([feedback("user-reply")]) } },
    "comments-next": { node: { comments: page([feedback("user-late")]) } },
    "reviews-next": {
      node: { reviews: page([feedback("bot-late", "coderabbitai")]) },
    },
  };
  const h = harness(
    repository(
      [item, ...Array.from({ length: 19 }, (_, i) => pr(i + 2))],
      "prs-next",
    ),
    ({ cursor }) => {
      assert.ok(routes[cursor], `unexpected cursor ${cursor}`);
      return routes[cursor];
    },
  );
  const result = h.execute();
  assert.equal(result.code, 0, result.stdout);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.prs.length, 21);
  assert.equal(snapshot.prs[0].ci.failed[0].name, "failed-late");
  assert.equal(snapshot.prs[0].threads[0].comments[0].id, "user-reply");
  assert.equal(snapshot.prs[0].comments[0].id, "user-late");
  assert.equal(snapshot.prs[0].reviews[0].id, "bot-late");
  assert.equal(h.calls.length, 7);
  assert.equal(
    h.calls.find(({ cursor }) => cursor === "checks-next").id,
    "commit-1",
  );
  assert.equal(
    h.calls.find(({ cursor }) => cursor === "replies-next").id,
    "late",
  );
});

test("retries UNKNOWN mergeability once and preserves UNKNOWN when GitHub cannot decide", () => {
  for (const mergeable of ["MERGEABLE", "CONFLICTING", "UNKNOWN"]) {
    const h = harness(
      repository([pr(1, { mergeable: "UNKNOWN" })]),
      ({ id }) => {
        assert.equal(id, "pr-1");
        return {
          node: {
            headRefOid: "head-1",
            baseRefOid: "base",
            mergeable,
            mergeStateStatus: "UNKNOWN",
          },
        };
      },
    );
    const result = h.execute();
    assert.equal(result.code, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).prs[0].mergeable, mergeable);
    assert.equal(h.calls.length, 2);
  }
});

test("missing rollup means no checks; missing or mismatched head is an error", () => {
  const item = pr(1);
  item.commits.nodes[0].commit.statusCheckRollup = null;
  const result = harness(repository([item])).execute();
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout).prs[0].ci, {
    state: null,
    failed: [],
    pending: [],
  });
  for (const commits of [
    { nodes: [] },
    { nodes: [{ commit: { oid: "old" } }] },
  ]) {
    assert.equal(harness(repository([pr(1, { commits })])).execute().code, 1);
  }
});

test("partial responses, pagination failures and moving heads fail without a partial survey", () => {
  const cases = [
    [null],
    [{ repository: null }],
    [
      {
        repository: {
          nameWithOwner: "toddmedema/electrify",
          pullRequests: { nodes: [] },
        },
      },
    ],
    [repository([null])],
    [repository([], "repeat"), () => repository([], "repeat")],
    [
      repository([pr(1, { comments: page([], "gone") })]),
      () => ({ node: null }),
    ],
    [
      repository([pr(1, { mergeable: "UNKNOWN" })]),
      () => ({ node: { headRefOid: "new", baseRefOid: "base" } }),
    ],
    [
      repository([pr(1, { mergeable: "UNKNOWN" })]),
      () => ({ node: { headRefOid: "head-1", baseRefOid: "new" } }),
    ],
  ];
  for (const [first, next] of cases) {
    const result = harness(first, next).execute();
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ["error"]);
  }
  for (const response of [
    { errors: [{ message: "rate limited" }], data: repository([]) },
    {},
    "invalid JSON",
  ]) {
    const result = run(["--repo", "toddmedema/electrify"], {
      runGh: () =>
        typeof response === "string" ? response : JSON.stringify(response),
    });
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).error);
  }
});

test("repeated surveys do not consume attempts, suppress feedback or touch existing monitor files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-triage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["state.json", "pending.json", "lock"])
    fs.writeFileSync(path.join(directory, name), "existing monitor state");
  const files = fs.readdirSync(directory);
  const previous = process.env.PR_TRIAGE_STATE_DIR;
  process.env.PR_TRIAGE_STATE_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.PR_TRIAGE_STATE_DIR;
    else process.env.PR_TRIAGE_STATE_DIR = previous;
  });
  const first = repository([pr(1, { comments: page([feedback("user")]) })]);
  const before = harness(first).execute();
  assert.equal(before.code, 0);
  assert.deepEqual(harness(first).execute(), before);
  assert.deepEqual(fs.readdirSync(directory), files);
  for (const name of files)
    assert.equal(
      fs.readFileSync(path.join(directory, name), "utf8"),
      "existing monitor state",
    );
});

test("CLI rejects old stateful options and invalid repositories without contacting GitHub", () => {
  for (const argv of [
    [],
    ["--finish"],
    ["--dry-run"],
    ["--repo", "bad"],
    ["--repo", "a/b", "--state-dir", "/tmp/state"],
  ]) {
    const result = run(argv, { runGh: () => assert.fail("must not call gh") });
    assert.equal(result.code, 1);
  }
});

test("CLI reports gh errors with a nonzero exit and one JSON line", (t) => {
  if (process.platform === "win32") return t.skip("POSIX gh stub");
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-triage-gh-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(directory, "gh"),
    "#!/bin/sh\necho 'network unavailable' >&2\nexit 1\n",
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    [
      path.resolve("scripts/dev/pr-triage.js"),
      "--repo",
      "toddmedema/electrify",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  assert.match(JSON.parse(result.stdout).error, /network unavailable/);
  assert.equal(result.stderr, "");
});
