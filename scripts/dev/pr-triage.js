#!/usr/bin/env node
/**
 * Read-only metadata survey for the PR monitor:
 *   node scripts/dev/pr-triage.js --repo toddmedema/electrify
 *
 * Prints one JSON object containing every open PR, latest-head failed/pending checks, and
 * toddmedema/CodeRabbit feedback IDs and update times. Never fetches comment bodies or writes
 * files. The caller owns actionability, handled feedback, workers and retry budgets. A changed
 * head alone must not reset the caller's budget for an unresolved issue.
 *
 * The usual survey needs one GraphQL request. All relevant connections are paginated; UNKNOWN
 * mergeability is retried once per PR. An incomplete/error response exits 1 instead of claiming
 * the repository is clean. Refresh live PR state before acting on this advisory snapshot.
 */
const { execFileSync } = require("node:child_process");

const PAGE_INFO = "pageInfo{hasNextPage endCursor}";
const FEEDBACK = "id author{login} updatedAt";
const CHECKS = `__typename
... on CheckRun{id name status conclusion startedAt completedAt}
... on StatusContext{id context state createdAt}`;
const THREADS = `id isResolved isOutdated path line
comments(first:10){${PAGE_INFO} nodes{${FEEDBACK}}}`;
const PR_FIELDS = `id number url isDraft headRefName headRefOid baseRefOid mergeable mergeStateStatus
commits(last:1){nodes{commit{id oid statusCheckRollup{state
contexts(first:100){${PAGE_INFO} nodes{${CHECKS}}}}}}}
reviewThreads(first:100){${PAGE_INFO} nodes{${THREADS}}}
comments(first:100){${PAGE_INFO} nodes{${FEEDBACK}}}
reviews(first:100){${PAGE_INFO} nodes{${FEEDBACK}}}`;
const QUERY = `query($owner:String!,$repo:String!,$cursor:String){
repository(owner:$owner,name:$repo){nameWithOwner
pullRequests(states:OPEN,first:20,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){
${PAGE_INFO} nodes{${PR_FIELDS}}}}}`;
const FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const AUTHORS = new Set(["toddmedema", "coderabbitai"]);

function ghRunner(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
  } catch (error) {
    if (error.code === "ETIMEDOUT") throw new Error("gh timed out after 60s");
    throw new Error(
      `gh failed: ${
        String(error.stderr || error.message)
          .trim()
          .split("\n")[0]
      }`,
    );
  }
}

function graphql(runGh, query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) args.push("-f", `${key}=${value}`);
  }
  const response = JSON.parse(runGh(args));
  if (response.errors?.length)
    throw new Error(`GraphQL: ${response.errors[0].message}`);
  if (!response.data) throw new Error("Missing GraphQL data");
  return response.data;
}

function allPages(first, next) {
  const nodes = [];
  const cursors = new Set();
  let page = first;
  for (;;) {
    if (
      !Array.isArray(page?.nodes) ||
      typeof page.pageInfo?.hasNextPage !== "boolean"
    )
      throw new Error("Incomplete GraphQL connection");
    if (page.nodes.some((node) => !node))
      throw new Error("Missing GraphQL node");
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    const cursor = page.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor))
      throw new Error("Invalid pagination cursor");
    cursors.add(cursor);
    page = next(cursor);
  }
}

function nodePages(runGh, node, type, field, fields, initial, wrapper = "") {
  return allPages(initial, (cursor) => {
    const connection = `${field}(first:100,after:$cursor){${PAGE_INFO} nodes{${fields}}}`;
    const selection = wrapper ? `${wrapper}{${connection}}` : connection;
    const query = `query($id:ID!,$cursor:String!){node(id:$id){... on ${type}{${selection}}}}`;
    const result = graphql(runGh, query, { id: node.id, cursor }).node;
    return (wrapper ? result?.[wrapper] : result)?.[field];
  });
}

function feedback(nodes) {
  return nodes
    .filter((node) =>
      AUTHORS.has(
        (node.author?.login || "").toLowerCase().replace(/\[bot\]$/, ""),
      ),
    )
    .map((node) => ({
      id: node.id,
      author: node.author.login,
      updatedAt: node.updatedAt,
    }));
}

function summarizeChecks(nodes, state) {
  const failed = [];
  const pending = [];
  for (const check of nodes) {
    if (check.__typename === "CheckRun") {
      if (check.status !== "COMPLETED") pending.push(check);
      else if (FAILED.has(check.conclusion)) failed.push(check);
    } else if (check.__typename === "StatusContext") {
      if (["PENDING", "EXPECTED"].includes(check.state)) pending.push(check);
      else if (["FAILURE", "ERROR"].includes(check.state)) failed.push(check);
    } else throw new Error("Unknown check context type");
  }
  return { state, failed, pending };
}

function summarizePr(runGh, pr) {
  if (pr.mergeable === "UNKNOWN") {
    const query = `query($id:ID!){node(id:$id){... on PullRequest{headRefOid baseRefOid mergeable mergeStateStatus}}}`;
    const refreshed = graphql(runGh, query, { id: pr.id }).node;
    if (
      !refreshed ||
      refreshed.headRefOid !== pr.headRefOid ||
      refreshed.baseRefOid !== pr.baseRefOid
    )
      throw new Error(`#${pr.number} changed during survey; run again`);
    pr = { ...pr, ...refreshed };
  }
  // commits(last:1) intentionally selects only the head, not the full commit history.
  const commit = pr.commits?.nodes?.[0]?.commit;
  if (!commit || commit.oid !== pr.headRefOid)
    throw new Error(`#${pr.number} has no matching head commit`);
  const rollup = commit.statusCheckRollup;
  const checks =
    rollup === null
      ? []
      : nodePages(
          runGh,
          commit,
          "Commit",
          "contexts",
          CHECKS,
          rollup?.contexts,
          "statusCheckRollup",
        );
  const threads = nodePages(
    runGh,
    pr,
    "PullRequest",
    "reviewThreads",
    THREADS,
    pr.reviewThreads,
  )
    .filter((thread) => !thread.isResolved)
    .map((thread) => ({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      outdated: thread.isOutdated,
      comments: feedback(
        nodePages(
          runGh,
          thread,
          "PullRequestReviewThread",
          "comments",
          FEEDBACK,
          thread.comments,
        ),
      ),
    }))
    .filter((thread) => thread.comments.length);
  return {
    number: pr.number,
    url: pr.url,
    branch: pr.headRefName,
    draft: pr.isDraft,
    headSha: pr.headRefOid,
    baseSha: pr.baseRefOid,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    ci: summarizeChecks(checks, rollup?.state ?? null),
    threads,
    comments: feedback(
      nodePages(runGh, pr, "PullRequest", "comments", FEEDBACK, pr.comments),
    ),
    reviews: feedback(
      nodePages(runGh, pr, "PullRequest", "reviews", FEEDBACK, pr.reviews),
    ),
  };
}

function survey(repo, runGh = ghRunner) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || ""))
    throw new Error("--repo requires OWNER/NAME");
  const [owner, name] = repo.split("/");
  const fetchPage = (cursor) => {
    const repository = graphql(runGh, QUERY, {
      owner,
      repo: name,
      cursor,
    }).repository;
    if (!repository?.nameWithOwner)
      throw new Error(`Repository not found: ${repo}`);
    return repository;
  };
  const first = fetchPage();
  const prs = allPages(
    first.pullRequests,
    (cursor) => fetchPage(cursor).pullRequests,
  );
  return {
    repository: first.nameWithOwner,
    prs: prs.map((pr) => summarizePr(runGh, pr)),
  };
}

function run(argv, { runGh = ghRunner } = {}) {
  try {
    if (argv.length !== 2 || argv[0] !== "--repo")
      throw new Error("Usage: node scripts/dev/pr-triage.js --repo OWNER/NAME");
    return { code: 0, stdout: JSON.stringify(survey(argv[1], runGh)) };
  } catch (error) {
    return { code: 1, stdout: JSON.stringify({ error: error.message }) };
  }
}

if (require.main === module) {
  const result = run(process.argv.slice(2));
  process.stdout.write(`${result.stdout}\n`);
  process.exitCode = result.code;
}

module.exports = { run, survey, summarizeChecks };
