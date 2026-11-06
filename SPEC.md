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

The seven named current built-in challenge definitions determine scope. Their delivery grouping must not introduce public categories, difficulty ratings, or strategic recommendations. Use existing artwork and English prose, preserve special characters and icon filenames, and retain current catalog order.

Editorial claims must match scenario definitions and relevant authored events. Do not present simulated situations as historical facts or forecasts, promise outcomes, recommend unsupported optimal strategies, or copy event schedules. Avoid unnecessary numeric game facts; every retained numeric fact requires a consistency assertion. Report source ambiguity that changes a scenario's meaning instead of inventing mechanics.

Do not change game data, simulation formulas, scenario IDs, save structures, or records assigned to the other editorial workstream.

## Feature List

Author scenario landing-page content for Carbon Fee, The Shale Boom, Paradise, Rise of Renewables, The End of an Era, Data Center Boom, and Across the Valley. Each scenario must have a distinctive introduction, main challenge, meaningful player decisions, learning outcomes, unique title, and unique meta description.

Keep the Data Center Boom landing page focused on its electricity-market challenge and `public/data-centers.html` focused on broader education. Preserve distinct canonical URLs and add ordinary links in both directions, secondary to the primary play action.

## Technical Architecture

Depend on `static-scenario-page-generator` to render each editorial record at `/scenarios/<stable-slug>.html` with a primary play link to `/?scenario=<id>`. No new API is introduced.

Review each assigned definition in `src/data/Scenarios.tsx` and its relevant authored event sources before writing. Describe decisions through actual modeled constraints. Use concise copy, direct headings, decision-oriented lists, and visible scenario names beside artwork.

Render assigned records through the generator with valid supporting fixtures for cross-workstream references. Validate required fields, local assets, metadata uniqueness within the subset, encoded destinations, and any retained numeric claims; review each page against its scenario and event sources. The integration sub-plan owns whole-catalog completeness and cross-workstream uniqueness checks; whole-catalog automated validation and browser QA remain with their owning sub-plans.

## Data Model

Populate exactly one complete record per assigned scenario in the shared build-only editorial manifest. Each record must contain its persisted scenario ID, exact presentation references, an explicit stable lowercase slug, introduction, main challenge, meaningful player decisions, learning outcomes, title, meta description, and a small set of relevant related scenarios referenced by eligible IDs.

Establish stable slugs before adding cross-links. Titles and descriptions must differ meaningfully, beyond simple string uniqueness.

## API Contracts

_No content yet_

## Non-Functional Requirements

_No content yet_

## Open Questions

_No content yet_
