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

- Use Node 26 and existing locked dependencies where practical.
- The production canonical origin is `https://electrifygame.com`.
- Proposed build-only locations are `scripts/scenario-pages/` and `content/scenario-pages.json`; implementation may follow established repository naming conventions.
- This foundation has no sibling sub-plan dependency and must be independently verifiable with fixtures; production content comes from two editorial sub-plans.
- Sitemap generation, production build wiring, and production browser testing belong to the integration sub-plan.
- Preserve ScenarioType, scenario IDs, saves, multiplayer payloads, and RunCompatibility.json.

## Feature List

- Generate complete static `/scenarios.html` and `/scenarios/<slug>.html` documents with readable content and ordinary navigation when JavaScript is disabled.
- Each detail page includes one descriptive H1, the scenario premise, introduction, challenge, decisions, learning outcomes, breadcrumbs, related scenarios, and a dominant play link to `/?scenario=<id>`.
- Provide unique page titles and descriptions, absolute self-referencing canonical URLs, matching Open Graph and Twitter metadata, and parseable WebPage JSON-LD consistent with visible content.

## Technical Architecture

- Implement a deterministic Node generator with separate record validation, URL derivation, shared HTML template rendering, and artifact writing.
- Read structured editorial data, templates, and local assets for validation without importing Scenarios.tsx, Redux, React, or simulation modules; keep build-only editorial code and data outside the simulation runtime dependency graph.
- Derive canonical, social, breadcrumb, related, and play destinations from validated records.
- Reuse the existing brand header, privacy/about footer, gameplay preview image, scenario artwork, logo, and social-preview assets. Scope additions to `public/legal.css` to preserve existing learning-page presentation.
- Generated pages must not load the React bundle, simulation data, authentication, or required scripts.
- Validate scenario IDs structurally and related references against supplied records; real-catalog eligibility remains the responsibility of a later Jest contract.

## Data Model

Introduce a build-only editorial record contract containing `scenarioId`, `slug`, `name`, `icon`, `title`, `description`, `introduction`, `challenge`, `decisions`, `learningOutcomes`, and `relatedScenarioIds`.

Use structured text and lists rather than editorial HTML. Require complete, nonempty content; unique IDs, slugs, titles, descriptions, and derived canonical URLs; valid local assets; and related IDs that reference supplied records without duplicates or self-references.

## API Contracts

Expose a generator entry point accepting an output directory and content records. Emit the scenario index and detail HTML documents and return artifact information suitable for later sitemap integration. Fail unsuccessfully with actionable diagnostics on invalid input or rendering errors. No backend API is added.

## Non-Functional Requirements

- Identical inputs must produce identical output bytes without timestamps. Write only owned artifacts inside the specified output directory, preserve unrelated files, and limit cleanup to demonstrably owned generated files.
- Reject incomplete records, malformed metadata, unsafe paths, traversal sequences, separators or arbitrary URLs in slugs, invalid related references, and missing assets. Never substitute generic copy or resolve unknown slugs to arbitrary records.
- Escape text and attributes, encode asset URLs correctly, support special characters and filenames containing spaces, safely serialize XML-compatible URL values, and prevent JSON-LD content from breaking out of its script element.
- Use accessible semantics, a skip link, visible focus, semantic headings, descriptive links, appropriate image alternatives, and explicit image dimensions.
- Provide responsive light and dark presentation using existing color tokens and the 4 px spacing rhythm. Controls must be at least 40 px high on desktop and 44 px on coarse-pointer devices; stack content at phone widths and support 1280, 390, and 360 px layouts. Reading must remain available without theme storage or analytics.
- Use focused Node tooling tests and the verify-electrify approach, pairing valid fixtures with deliberate violations of schema, duplicate, metadata, path, relationship, asset, and serialization guards. Verify semantic HTML, one H1 per detail page, required sections, metadata consistency, parseable JSON-LD, deterministic bytes, arbitrary output directories, preservation of unrelated files, and absence of game or simulation resources.

## Open Questions

_No content yet_
