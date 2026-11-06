# Product Specification

## Executive Summary

_No content yet_

## Problem Statement

_No content yet_

## User Personas

_No content yet_

## Goals and Success Metrics

_No content yet_

## Assumptions and Constraints

This work depends on `static-scenario-page-generator`, `transition-and-growth-scenario-content`, and `disruption-and-recovery-scenario-content`.

The plan assumes `scripts/build.js` derives its output directory from `BUILD_PATH` or `build` and performs the production build before existing post-build checks. `public/sitemap.xml` remains the source of existing non-scenario entries. Existing scenario URL resolution and application entry behavior require no implementation changes.

Keep changes focused on build integration, catalog contracts, sitemap generation, discovery links, and artifact verification. Preserve unrelated static-page styling and content. Remote stale-file retirement remains a release-process responsibility rather than automatic generator deletion.

## Feature List

- Publish a scenario index at `/scenarios.html` and editorial pages at `/scenarios/<slug>.html`, ordered consistently with the game catalog.
- Add descriptive HTML links to the scenario index from `public/about.html` and the root document's static navigation, preserving the existing navigation hierarchy.
- Include the index and each scenario page exactly once in the production sitemap while preserving existing entries and metadata.
- Preserve existing static pages and game entry links. The Data Center learning-page cross-link belongs to the transition-content sub-plan.

## Technical Architecture

Integrate the static scenario generator and complete editorial manifest into `scripts/build.js` after a successful CRA build, respecting `BUILD_PATH` and the default `build` directory. Preserve existing version and edition checks, and propagate generation failures as build failures.

Merge validated artifact URLs with `public/sitemap.xml` into the production sitemap without modifying the source sitemap or adding build-time modification dates. Output must be deterministic and support regeneration into an existing output directory without overwriting source files or unrelated artifacts.

Keep the editorial manifest build-only and outside the game runtime dependency graph. Place the real-catalog contract in the existing TypeScript Jest environment so production generation remains independent of React and simulation imports. Include this contract in existing pre-publication quality gates. Do not commit or modify generated `RunCompatibility.json`.

## Data Model

Populate exactly one complete record per assigned scenario in the shared build-only editorial manifest. Each record must contain the correct persisted scenario ID, visible name, icon, stable explicit slug, introduction, main challenge, meaningful decisions, learning outcomes, title, description, and relevant related IDs.

Read Chernobyl: Recovery's exact exported ID and definition from `src/data/ChernobylScenario.ts`; do not infer its ID from catalog position. Slugs must remain independent of display-name punctuation, including Heatwave + Drought and Chernobyl: Recovery. Related IDs must identify eligible challenges and exclude tutorials, legacy generations, custom games, and mods.

No runtime domain model, save schema, scenario identifier, or simulation data changes are required.

## API Contracts

Production output includes `/scenarios.html`, `/scenarios/<slug>.html`, and merged `/sitemap.xml`. Every generated play query must resolve through `scenarioFromSearch` to its intended scenario record. Build failure diagnostics must identify the offending record, field, URL, or asset. No new backend endpoint or gameplay route is introduced.

## Non-Functional Requirements

- Compare the editorial manifest against the actual eligible `SCENARIOS` set, including imported scenarios, and verify names, icons, catalog ordering, and play-query resolution.
- Reject missing, extra, duplicate, tutorial, legacy-only, custom, removed, or otherwise invalid editorial references. Use valid and violating fixtures to demonstrate that guards fail for the intended reason, including a newly eligible scenario without content.
- Test sitemap preservation, deduplication, escaping, deterministic output, conflicting URLs, malformed source sitemap data, and canonical agreement.
- Verify generation failure propagation and artifact placement for default and custom `BUILD_PATH` values.
- Semantically validate every generated document's metadata, structured content, local links, and canonical, social, and sitemap URL agreement. Avoid broad snapshots.
- Preserve preview indexing controls and separately verify that production pages receive no accidental `noindex` directive.
- Run focused Node and Jest suites plus applicable lint and type checks. Final integrated and browser evidence belongs to the next sub-plan.

## Open Questions

_No content yet_
