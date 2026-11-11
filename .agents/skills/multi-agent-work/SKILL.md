---
name: multi-agent-work
description: Plan and run Electrify work that uses subagents (parallel reviewers, QA agents, coder clusters, a final reviewer, or several agents discussing a change) without runaway context or token use. Use before spawning any subagent, and when a user asks for multi-agent review, QA, or fixes.
---

# Multi-agent work in Electrify

Works the same in Claude Code (Agent tool: `subagent_type`, `model`, `isolation: "worktree"`)
and Codex (your subagent tool, one worktree per writer). Read [AGENTS.md](../../../AGENTS.md)
for commands, checks and interface rules; this skill only covers how to split the work.

## Why

In the last 20 agent sessions, one coder subagent fixed a whole batch of QA findings in one
context: 400 turns, context growing from 63k to 471k tokens, 103M cache-read tokens (about 20% of
all usage), and 306 of its 400 tool calls were single `grep` or `sed -n` lookups. QA reviewers
took 70-90 turns (10-12M tokens) each. Agents also viewed 320 screenshots (about 35 MB), each
re-read on every later turn, and wrote 89 throwaway Playwright scripts with the same setup.

## 1. One shared brief

Write the brief once, to `.tmp/briefs/<task>.md` (git-ignored), and give every subagent its
absolute path plus its role in one or two sentences. Do not re-describe the repo in each prompt.
The brief holds:

- goal, non-goals, and the scope (directories, components, scenarios, viewports);
- the AGENTS.md sections that matter for this task, named rather than pasted (for example
  "Interface design", "Scenario writing", "Guardrails");
- file pointers: owning component, test suite, e2e spec and helper (`e2e/layout.ts`), symbols to
  `rg` first;
- how to verify (focused Jest suite, `npm run test:e2e -- <spec> ...`, `npm run shot`) and the
  finding format below;
- budgets: reviewers about 30 tool calls, coders about 100 turns.

## 2. Read-only reviewers

- Use a cheaper model. Reviewers do not edit, commit, or run the full check.
- Split by area or lens (360 px layout, dark mode, copy, accessibility, an invariant), not by
  "review everything".
- Return at most 10 findings, one line each, no prose, praise, or diff recap:
  `file:line | blocker/major/minor | problem (<=25 words) | proposed fix (<=25 words)`.
- Every finding cites evidence: DOM text, a computed style, an assertion, or a clipped `shot` path.
- The lead dedupes before any coding: merge by `file:line` and problem, drop duplicates and
  anything AGENTS.md contradicts, order by severity, then cluster.

## 3. Coders: one fresh coder per cluster

- A cluster is about 5 related findings in one component or file area. Never hand a whole batch
  to one coder. Give it the brief path and only its cluster; a fresh context keeps it cheap.
- Clusters with disjoint files run in parallel, each in its own worktree and branch; the lead
  merges. Overlapping clusters run one after another. Each checkout is claimed once (AGENTS.md
  "Start here"), so parallel coders need separate worktrees.
- A coder runs only focused checks (one Jest suite, the changed e2e spec), commits per logical
  fix, and reports commit hashes. If it passes about 100 turns or 150k tokens, it commits and
  stops; leftover findings go to a new coder.

## 4. Final reviewer

Review `git diff --stat origin/master...HEAD`, then that diff and the touched files, not the
whole repo. Check that each finding is fixed and nothing nearby regressed. Same capped format,
one round. Only blockers go back to a fresh coder.

## 5. Cheap lookups and cheap proof

- Batch independent lookups: several `rg -n` or `sed -n 'a,bp'` in one command (separate them
  with `echo ---`), or parallel tool calls in one message. Read a symbol's whole range once, not
  many one-line slices.
- Verify UI from evidence that costs text, not pixels: DOM text and attributes, computed styles,
  or an existing spec. Use images last, as proof.
- For images, `npm run shot` instead of a new Playwright script. Defaults are one 1280 px
  viewport at device scale 1; use `--clip` for the one component you changed:

  ```
  npm start                      # background; prints "Reserved E2E_PORT=<port>"
  npm run shot -- --scenario 108 --view facilities --viewports 1280,390,360 \
    --theme light,dark --clip ".facilityRow:has-text('Solar')"
  ```

  It prints one line per PNG (default directory `.tmp/shots`). Look at each image once. Do not re-open unchanged shots after later edits. Stop `npm start`
  when finished; it holds a validation reservation.

## 6. Integration and models

- The integrating agent owns the final `npm run check:ci` (AGENTS.md "Start here" and "Pull
  requests"), the PR, and its screenshots. Subagents never run the full check.
- Cheaper model: read-only review, search, mechanical clusters. Stronger model: the brief,
  clustering, dedupe and synthesis, and hard fixes (simulation, saves, cross-file refactors).
- For "have N agents discuss": ask each for a position of at most 150 words and its top three
  risks from a distinct lens, written to the brief directory. The lead synthesizes; agents do not
  relay transcripts to each other.
