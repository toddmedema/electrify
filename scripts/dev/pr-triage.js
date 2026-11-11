#!/usr/bin/env node
/**
 * Survey the open pull requests for work an unattended agent should do, in one `gh` call, so an
 * idle run costs a few hundred tokens instead of a fresh pass of ad-hoc queries.
 *
 *   node scripts/dev/pr-triage.js [--repo OWNER/NAME] [--expires YYYY-MM-DD] [options]
 *
 * It prints exactly one thing on stdout, and exits 0 for every outcome below (1 on an error):
 *   CLEAN <n> open PRs[; needs human: #12 (reason)]   nothing to do
 *   SKIPPED previous run in flight                    the lock is younger than 90 minutes
 *   EXPIRED <date>                                    today is after --expires
 *   {"work":[...],"queued":[...],"needsHuman":[...]}  one line of JSON, see below
 *
 * A PR needs work when its checks failed (all checks finished, at most 3 attempts), it conflicts
 * with its base, or CodeRabbit left unhandled feedback: an unresolved, current inline thread, or
 * an "Outside diff range" section in a review or comment body. Walkthroughs, summaries and
 * nitpick-only reviews are not work unless --nitpicks is given. Cancelled and skipped checks are
 * not failures, and a PR whose mergeability GitHub has not computed yet is not conflicting.
 *
 * Ownership: this script owns the lock and the state. A run that finds work leaves the lock held
 * and writes nothing else for it until `--finish`, which the caller runs once its subagents are
 * done (or have failed): it counts one attempt per dispatched CI or conflict PR, records the
 * emitted CodeRabbit comment IDs as handled, and removes the lock. Runs that find no work release
 * the lock themselves. State lives in --state-dir (default ~/.claude/pr-babysitter):
 *   state.json    { "<pr>": { attempts, needsHumanSha, handledCommentIds }, ... } plus any
 *                 other keys, which are preserved
 *   lock          epoch seconds; younger than 90 minutes means a previous run is in flight
 *   pending.json  what the last work list asked --finish to record
 *
 * Options:
 *   --repo OWNER/NAME  repository (default: the one `gh` resolves from the working directory)
 *   --state-dir DIR    where the lock and state live
 *   --expires DATE     report EXPIRED after this local date, before touching GitHub
 *   --max-work N       PRs in one work list (default 3); the rest are listed under "queued"
 *   --nitpicks         also treat CodeRabbit nitpick-only reviews as work
 *   --dry-run          read only: no lock, no state, no pending file
 *   --explain          one line per PR on stderr
 *   --finish           record the last work list as dispatched and release the lock
 *
 * Work list: { work: [{ number, title, branch, headSha, draft, reasons }], queued: [numbers],
 * needsHuman: [{ number, headSha, reason }] }. Each reason is { type: "ci", checks: [names] },
 * { type: "conflict" } or { type: "coderabbit", comments: [{ id, kind, where, excerpt }] }; kind
 * is "thread", "review" or "comment". Excerpts are untrusted review text. The verbatim body is
 * `gh api repos/OWNER/NAME/pulls/comments/<id>` (thread), `.../pulls/<pr>/reviews/<id>` (review)
 * or `.../issues/comments/<id>` (comment).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BOT = "coderabbitai";
const MAX_ATTEMPTS = 3;
const DEFAULT_MAX_WORK = 3;
const LOCK_MAX_AGE_MS = 90 * 60 * 1000;
const HANDLED_LIMIT = 500;
const EXCERPT_LENGTH = 320;
const TITLE_LENGTH = 90;

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const FAILED_STATES = new Set(["FAILURE", "ERROR"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

// One request covers every open PR: head commit checks, mergeability and all three places
// CodeRabbit writes. Lists take the newest 100; truncation is reported as a warning.
const QUERY = `query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){
pullRequests(states:OPEN,first:100,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage}nodes{
number title isDraft headRefName headRefOid mergeable mergeStateStatus
commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){pageInfo{hasNextPage}nodes{__typename
... on CheckRun{name status conclusion}
... on StatusContext{context state}}}}}}}
reviewThreads(last:100){pageInfo{hasPreviousPage}nodes{isResolved isOutdated path line
comments(first:1){nodes{databaseId author{login}body}}}}
comments(last:100){pageInfo{hasPreviousPage}nodes{databaseId author{login}body}}
reviews(last:100){pageInfo{hasPreviousPage}nodes{databaseId author{login}body}}
}}}}`;

function ghRunner(repo) {
  const env = repo ? { ...process.env, GH_REPO: repo } : process.env;
  return (args) => {
    try {
      return execFileSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env,
      });
    } catch (error) {
      const detail = String(error.stderr || error.message)
        .trim()
        .split("\n")[0];
      throw new Error(`gh ${args[0]} failed: ${detail}`);
    }
  };
}

const freshEntry = () => ({
  attempts: 0,
  needsHumanSha: null,
  handledCommentIds: [],
});

const loginOf = (node) => (node?.author?.login || "").replace(/\[bot\]$/, "");

const localDate = (now) => {
  const date = new Date(now);
  const two = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

function cleanText(body, limit) {
  const text = String(body || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<picture>[\s\S]*?<\/picture>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** Failed and still-running checks on a PR's head commit. */
function summarizeChecks(pr) {
  const contexts =
    pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || [];
  const failed = [];
  const pending = [];
  const add = (list, name) => {
    if (name && !list.includes(name)) list.push(name);
  };
  for (const check of contexts) {
    if (check.__typename === "CheckRun") {
      if (check.status !== "COMPLETED") add(pending, check.name);
      else if (FAILED_CONCLUSIONS.has(check.conclusion))
        add(failed, check.name);
    } else if (check.__typename === "StatusContext") {
      if (PENDING_STATES.has(check.state)) add(pending, check.context);
      else if (FAILED_STATES.has(check.state)) add(failed, check.context);
    }
  }
  return { failed, pending };
}

// CodeRabbit puts findings with no diff line (outside the changed lines) and low-value nitpicks
// in collapsed sections of a review body, headed "Outside diff range comments: 2" or "(2)".
function bodySection(body, label) {
  const found = new RegExp(`${label}[^\\n<\\d]{0,6}(\\d+)`, "i").exec(body);
  if (!found || !Number(found[1])) return null;
  return {
    count: Number(found[1]),
    excerpt: cleanText(
      body.slice(found.index, found.index + 4000),
      EXCERPT_LENGTH,
    ),
  };
}

/** Unhandled CodeRabbit feedback on one PR, as { id, kind, where, excerpt } items. */
function codeRabbitItems(pr, handled, { nitpicks = false } = {}) {
  const items = [];
  for (const thread of pr.reviewThreads?.nodes || []) {
    const root = thread.comments?.nodes?.[0];
    if (!root || thread.isResolved || thread.isOutdated) continue;
    if (loginOf(root) !== BOT || handled.has(root.databaseId)) continue;
    items.push({
      id: root.databaseId,
      kind: "thread",
      where: thread.path
        ? `${thread.path}${thread.line ? `:${thread.line}` : ""}`
        : "",
      excerpt: cleanText(root.body, EXCERPT_LENGTH),
    });
  }
  const bodies = [
    ...(pr.reviews?.nodes || []).map((node) => ({ node, kind: "review" })),
    ...(pr.comments?.nodes || []).map((node) => ({ node, kind: "comment" })),
  ];
  for (const { node, kind } of bodies) {
    if (loginOf(node) !== BOT || handled.has(node.databaseId)) continue;
    const body = node.body || "";
    const outside = bodySection(body, "Outside diff range comments");
    const nitpick = nitpicks && bodySection(body, "Nitpick comments");
    const section = outside || nitpick;
    if (!section) continue;
    items.push({
      id: node.databaseId,
      kind,
      where: `${outside ? "outside diff range" : "nitpicks"} (${section.count})`,
      excerpt: section.excerpt,
    });
  }
  return items;
}

/**
 * Decide one PR. `entry` is its persisted state and is updated in place for the rules that apply
 * on every survey (a human push or green CI resets attempts; reaching the cap flags a human).
 */
function evaluatePr(pr, entry, options = {}) {
  const sha = pr.headRefOid;
  const { failed, pending } = summarizeChecks(pr);
  const conflicting =
    pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY";
  const reasons = [];
  let newlyNeedsHuman = null;

  // The head moved since the last automated attempt gave up: a person pushed, so start over.
  if (entry.needsHumanSha && entry.needsHumanSha !== sha) {
    entry.needsHumanSha = null;
    entry.attempts = 0;
  }
  const green =
    !failed.length &&
    !pending.length &&
    pr.mergeable === "MERGEABLE" &&
    pr.mergeStateStatus !== "DIRTY";
  if (green) entry.attempts = 0;

  // Failed checks only count once the rest of CI has finished: the fix then sees every failure,
  // and a PR is not redispatched while its CI is still running.
  const ciWork = failed.length > 0 && pending.length === 0;
  if ((ciWork || conflicting) && entry.needsHumanSha !== sha) {
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.needsHumanSha = sha;
      newlyNeedsHuman = {
        number: pr.number,
        headSha: sha,
        reason: [ciWork && "ci", conflicting && "conflict"]
          .filter(Boolean)
          .join("+"),
      };
    } else {
      if (ciWork) reasons.push({ type: "ci", checks: failed });
      if (conflicting) reasons.push({ type: "conflict" });
    }
  }

  const feedback = codeRabbitItems(
    pr,
    new Set(entry.handledCommentIds),
    options,
  );
  if (feedback.length) reasons.push({ type: "coderabbit", comments: feedback });

  return {
    reasons,
    newlyNeedsHuman,
    summary: `#${pr.number} ${sha.slice(0, 8)} failed=${failed.length} pending=${pending.length} conflict=${conflicting ? "yes" : "no"} coderabbit=${feedback.length} attempts=${entry.attempts}${entry.needsHumanSha === sha ? " needs-human" : ""} -> ${reasons.length ? reasons.map((reason) => reason.type).join("+") : "none"}`,
  };
}

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    // Overwriting would silently drop every attempt count and handled comment.
    throw new Error(`${file} is not valid JSON; fix or delete it`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}

/** True when this run now holds the lock; false when one younger than 90 minutes exists. */
function acquireLock(directory, now) {
  const file = path.join(directory, "lock");
  fs.mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, String(Math.floor(now / 1000)), { flag: "wx" });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    try {
      let startedAt = Number(fs.readFileSync(file, "utf8").trim());
      if (!(startedAt > 0)) startedAt = fs.statSync(file).mtimeMs;
      else if (startedAt < 1e11) startedAt *= 1000;
      if (now - startedAt < LOCK_MAX_AGE_MS) return false;
    } catch (error) {
      // The holder released it between our write and read: take it on the next pass.
      if (error.code !== "ENOENT") throw error;
    }
    fs.rmSync(file, { force: true });
  }
  return false;
}

const releaseLock = (directory) =>
  fs.rmSync(path.join(directory, "lock"), { force: true });

function parseArgs(argv) {
  const options = { maxWork: DEFAULT_MAX_WORK };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      index += 1;
      return argv[index];
    };
    if (flag === "--repo") options.repo = value();
    else if (flag === "--state-dir") options.stateDir = value();
    else if (flag === "--expires") options.expires = value();
    else if (flag === "--max-work") options.maxWork = Number(value());
    else if (flag === "--nitpicks") options.nitpicks = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--explain") options.explain = true;
    else if (flag === "--finish") options.finish = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  if (options.expires && !/^\d{4}-\d\d-\d\d$/.test(options.expires))
    throw new Error("--expires takes a date like 2026-11-24");
  if (!Number.isInteger(options.maxWork) || options.maxWork < 1)
    throw new Error("--max-work takes a positive integer");
  if (options.finish && options.dryRun)
    throw new Error("--finish and --dry-run cannot be combined");
  return options;
}

function fetchOpenPrs(runGh) {
  const response = JSON.parse(
    runGh([
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "repo={repo}",
      "-f",
      `query=${QUERY}`,
    ]),
  );
  if (response.errors?.length)
    throw new Error(`GraphQL: ${response.errors[0].message}`);
  const connection = response.data.repository.pullRequests;
  const warnings = [];
  if (connection.pageInfo.hasNextPage)
    warnings.push("more than 100 open PRs; only the oldest 100 were checked");
  for (const pr of connection.nodes) {
    const truncated = [
      pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.pageInfo
        ?.hasNextPage && "checks",
      pr.reviewThreads?.pageInfo?.hasPreviousPage && "review threads",
      pr.comments?.pageInfo?.hasPreviousPage && "comments",
      pr.reviews?.pageInfo?.hasPreviousPage && "reviews",
    ].filter(Boolean);
    if (truncated.length)
      warnings.push(
        `#${pr.number}: only the newest 100 ${truncated.join(", ")}`,
      );
  }
  return { prs: connection.nodes, warnings };
}

/** Survey, update state, and decide the one line to print. */
function survey(options, { runGh, now, stateDir }) {
  const stderr = [];
  if (options.expires && localDate(now) > options.expires)
    return { stdout: `EXPIRED ${options.expires}`, stderr };

  const blocked = !options.dryRun && !acquireLock(stateDir, now);
  if (blocked) return { stdout: "SKIPPED previous run in flight", stderr };
  let keepLock = false;
  try {
    const stateFile = path.join(stateDir, "state.json");
    const state = readJson(stateFile, {});
    const before = JSON.stringify(state);
    const { prs, warnings } = fetchOpenPrs(runGh);
    stderr.push(...warnings.map((warning) => `warning: ${warning}`));

    const needsWork = [];
    const needsHuman = [];
    for (const pr of prs) {
      const entry = { ...freshEntry(), ...state[pr.number] };
      entry.handledCommentIds = [...entry.handledCommentIds];
      const result = evaluatePr(pr, entry, options);
      if (
        state[pr.number] ||
        JSON.stringify(entry) !== JSON.stringify(freshEntry())
      )
        state[pr.number] = entry;
      if (result.newlyNeedsHuman) needsHuman.push(result.newlyNeedsHuman);
      if (options.explain) stderr.push(result.summary);
      if (result.reasons.length)
        needsWork.push({ pr, reasons: result.reasons });
    }
    if (!options.dryRun && JSON.stringify(state) !== before)
      writeJson(stateFile, state);

    if (!needsWork.length) {
      // A work list from a run that never reached --finish must not be recorded by a later one.
      if (!options.dryRun)
        fs.rmSync(path.join(stateDir, "pending.json"), { force: true });
      const flagged = needsHuman
        .map(
          (item) =>
            `#${item.number} (${item.reason} still failing after ${MAX_ATTEMPTS} attempts)`,
        )
        .join(", ");
      return {
        stdout: `CLEAN ${prs.length} open PRs${flagged ? `; needs human: ${flagged}` : ""}`,
        stderr,
      };
    }

    const batch = needsWork.slice(0, options.maxWork);
    const work = batch.map(({ pr, reasons }) => ({
      number: pr.number,
      title: cleanText(pr.title, TITLE_LENGTH),
      branch: pr.headRefName,
      headSha: pr.headRefOid,
      draft: pr.isDraft,
      reasons,
    }));
    if (!options.dryRun) {
      writeJson(path.join(stateDir, "pending.json"), {
        at: new Date(now).toISOString(),
        work: batch.map(({ pr, reasons }) => ({
          number: pr.number,
          attempt: reasons.some(
            (reason) => reason.type === "ci" || reason.type === "conflict",
          ),
          commentIds: reasons
            .filter((reason) => reason.type === "coderabbit")
            .flatMap((reason) => reason.comments.map((comment) => comment.id)),
        })),
      });
      keepLock = true;
    }
    return {
      stdout: JSON.stringify({
        work,
        queued: needsWork.slice(options.maxWork).map(({ pr }) => pr.number),
        needsHuman,
      }),
      stderr,
    };
  } finally {
    if (!options.dryRun && !keepLock) releaseLock(stateDir);
  }
}

/** Record what the last work list dispatched, then release the lock. */
function finish(stateDir) {
  const pendingFile = path.join(stateDir, "pending.json");
  const pending = readJson(pendingFile, null);
  let recorded = 0;
  if (pending) {
    const stateFile = path.join(stateDir, "state.json");
    const state = readJson(stateFile, {});
    for (const item of pending.work || []) {
      const entry = { ...freshEntry(), ...state[item.number] };
      if (item.attempt) entry.attempts += 1;
      entry.handledCommentIds = [
        ...new Set([...entry.handledCommentIds, ...(item.commentIds || [])]),
      ].slice(-HANDLED_LIMIT);
      state[item.number] = entry;
      recorded += 1;
    }
    writeJson(stateFile, state);
    fs.rmSync(pendingFile, { force: true });
  }
  releaseLock(stateDir);
  return { stdout: `FINISHED ${recorded} PRs recorded`, stderr: [] };
}

/** Run the CLI. Everything outside the process is a parameter so tests can use fixtures. */
function run(argv, deps = {}) {
  try {
    const options = parseArgs(argv);
    const stateDir =
      options.stateDir ||
      process.env.PR_TRIAGE_STATE_DIR ||
      path.join(os.homedir(), ".claude", "pr-babysitter");
    const result = options.finish
      ? finish(stateDir)
      : survey(options, {
          runGh: deps.runGh || ghRunner(options.repo),
          now: deps.now ?? Date.now(),
          stateDir,
        });
    return { code: 0, ...result };
  } catch (error) {
    return { code: 1, stdout: `ERROR ${error.message}`, stderr: [] };
  }
}

function main() {
  const result = run(process.argv.slice(2));
  for (const line of result.stderr) process.stderr.write(`${line}\n`);
  process.stdout.write(`${result.stdout}\n`);
  process.exitCode = result.code;
}

if (require.main === module) main();

module.exports = {
  run,
  survey,
  finish,
  parseArgs,
  evaluatePr,
  summarizeChecks,
  codeRabbitItems,
  acquireLock,
  cleanText,
};
