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

- This verification workstream depends on production-build-and-scenario-discovery delivering generated landing documents and a merged sitemap.
- Deployment, CDN changes, and live infrastructure changes require a separately authorized release. Publication remains the orchestrator's responsibility.
- Use existing save formats and gameplay contracts; do not introduce backend services or fallback routes.
- Live-host verification remains unrun until an authorized deployment. Local static hosting does not establish CloudFront error behavior.
- Slug removals or renames require an explicit redirect or retirement decision because non-deleting uploads may retain obsolete documents. Search ranking and traffic are observations, not release guarantees.

## Feature List

Provide original, scenario-specific landing-page editorial content for Hurricane Season, Deep Freeze, Heatwave + Drought, Sudden Nuclear Shutdown, Wildfire Emergency, Load Shedding, The River Runs Dry, Delhi Summer, and Chernobyl: Recovery.

Each record must explain the scenario's introduction, main challenge, meaningful player decisions, and learning outcomes, with a page title, description, and relevant related scenario IDs. Explain distinct challenges through their actual modeled conditions. Keep copy concise and suitable for the shared mobile layout, preserve visible names beside artwork, and avoid color-only meaning.

## Technical Architecture

Extend `e2e/learning-pages.spec.ts` and verify that the existing CI browser configuration selects it and reaches the new assertions. Reuse `e2e/layout.ts`, established fixtures, and the existing scenario-details suite. Test generated documents against production output through `E2E_BASE_URL`; the development server's public directory is insufficient evidence.

Representative coverage must include long titles, long prose, encoded image filenames, related links, the Data Center educational cross-link, unavailable storage, blocked analytics, existing saves, and browser history. Save-preservation checks must use an existing fixture and assert retained progress and the absence of automatic run start.

Follow verify-electrify to demonstrate that new browser assertions detect representative violations and accept valid neighboring cases. Run changed headless specs for desktop-chromium, mobile-390px, and mobile-360px, then required integrated gates before handoff. Reuse prior evidence only while valid, and distinguish passed, failed, skipped, and unrun checks. Do not add simulation-specific work solely for editorial changes; retain simulation gates required by integrated checks.

Inspect `scripts/deploy.sh` and existing release documentation, then document a scoped release checklist in existing documentation or a focused scenario-page document.

## Data Model

Populate exactly one complete record per assigned scenario in the shared build-only editorial manifest. Each record must contain the correct persisted scenario ID, visible name, icon, stable explicit slug, introduction, main challenge, meaningful decisions, learning outcomes, title, description, and relevant related IDs.

Read Chernobyl: Recovery's exact exported ID and definition from `src/data/ChernobylScenario.ts`; do not infer its ID from catalog position. Slugs must remain independent of display-name punctuation, including Heatwave + Drought and Chernobyl: Recovery. Related IDs must identify eligible challenges and exclude tutorials, legacy generations, custom games, and mods.

No runtime domain model, save schema, scenario identifier, or simulation data changes are required.

## API Contracts

Verify the observable behavior of `/scenarios.html`, representative `/scenarios/<slug>.html` documents, `/sitemap.xml`, and `/?scenario=<id>`.

Scenario play links must open the correct existing scenario details screen without automatically starting a run, overwriting saved progress, or bypassing start-game safeguards. Browser Back and Forward must preserve established application behavior and permit return to the landing document.

The release checklist must verify actual HTTP status codes, HTML responses, Content-Type headers, canonicals, sitemap discovery, unknown scenario-document behavior, and stale remote objects. Explicitly identify unknown paths that return an indexable SPA shell and any required CDN change without implementing that change.

## Non-Functional Requirements

Generated scenario index and representative detail documents must remain readable with JavaScript disabled in light and dark themes at viewport widths of 1280, 390, and 360 px. Verify no horizontal overflow, readable long titles and prose, loaded images, semantic navigation, visible keyboard focus, working skip links, and controls meeting the repository's size requirements.

Static documents must load without the React game bundle, simulation data, authentication, analytics availability, or available storage. Existing learning pages and static navigation must retain their behavior and presentation.

Review screenshots for hierarchy, contrast, wrapping, focus, control sizes, and image clarity across desktop and mobile layouts and both themes. Supply 1–3 representative reviewed images for orchestrator publication; keep artifacts temporary and free of personal data and debug overlays, and report capture or upload limitations.

## Open Questions

_No content yet_
