---
name: verify-electrify
description: Design and run verification for Electrify behavior changes, regression fixes, and guardrail improvements. Use when choosing evidence beyond routine formatting, especially for simulation, save/replay, boundary, or UI-flow changes.
---

# Verify Electrify

Read [AGENTS.md](../../../AGENTS.md) for commands and required checks. Use the
existing test runners and real reducer; this skill supplies judgment about what
to prove, without adding a second checklist of gates.

## Choose the contract

State the observable failure or invariant before choosing a test. Trace the
affected entry points: live play, headless simulation, forecast workers, replay,
save upgrade/import, or multiplayer, as applicable. Search the neighboring suites
and reuse their fixtures and setup rather than building a parallel model.

Prefer making invalid states unrepresentable with types or a single owning API.
For a syntactic footgun, extend the existing ESLint configuration. Use behavioral
tests for contracts that need runtime evidence. Add prose only for decisions that
cannot be enforced cheaply. Do not add a new verifier just because a task mentions
verification; formal models need a specific state-machine question to justify them.

## Prove the check can fail

For a regression, reproduce the failure before the fix when practical. For a new
guard, deliberately supply a violating example through the actual typechecker,
lint configuration, parser, or public API, and a valid neighboring example. Ensure
the check fails for the intended reason. Remove temporary mutations afterward.

Assert player-visible behavior, accepted/rejected payloads, or domain invariants.
Avoid source-text matching, duplicating implementation formulas, incidental UI
copy, or timing/pixel assertions unrelated to the contract. Keep test setup short
and explicitly wait for readiness when asynchronous initialization is involved.

For deterministic simulation changes, preserve registered stream IDs and compare
existing seeded outputs. Use the golden scenario suite and invariants already
run by the repository checks. Never update a snapshot, baseline, timeout, or
coverage floor merely to turn a failure green; explain intended behavior changes.

## Hand off evidence

Run focused checks while iterating, then the integrated checks required by
AGENTS.md. Distinguish passed, failed, skipped, and unrun checks, and invalidate
earlier evidence when its inputs change. Report current remote CI after opening
the PR; monitor it only when requested.

Identify any judgment still needed from a reviewer: whether the invariant matches
the game design, whether researched economic inputs are appropriate, whether a
save/protocol transition preserves player progress, or whether the interface makes
the next decision clear. Explain the specific remaining uncertainty instead of
asking for an undirected full-code review.
