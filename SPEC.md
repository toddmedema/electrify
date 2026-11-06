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

The nine assigned scenarios are assumed to complete the current eligible catalog alongside seven scenarios in the other editorial workstream. This workstream grouping creates no player-facing categories or recommendations. Preserve the catalog's existing presentation order when integrating the complete manifest.

Validate editorial claims against each scenario's starting conditions and relevant authored events, including the imported Chernobyl definition. Distinguish modeled situations from historical claims or forecasts, avoid unverified historical details, and make no guarantees about outcomes or optimal strategies. Omit incidental numeric details; retain numbers only when needed for understanding and backed by consistency checks.

Do not change game mechanics, event schedules, artwork, or source descriptions to fit landing-page copy.

## Feature List

Provide original, scenario-specific landing-page editorial content for Hurricane Season, Deep Freeze, Heatwave + Drought, Sudden Nuclear Shutdown, Wildfire Emergency, Load Shedding, The River Runs Dry, Delhi Summer, and Chernobyl: Recovery.

Each record must explain the scenario's introduction, main challenge, meaningful player decisions, and learning outcomes, with a page title, description, and relevant related scenario IDs. Explain distinct challenges through their actual modeled conditions. Keep copy concise and suitable for the shared mobile layout, preserve visible names beside artwork, and avoid color-only meaning.

## Technical Architecture

Depend on `static-scenario-page-generator` and populate only the nine assigned records in its shared build-only manifest. Delegate encoding and URL construction to the shared generator. Generated detail routes use stable `.html` slugs and link to the existing `/?scenario=<id>` play destination; no new API is required.

Validate assigned records through the generator, using supporting fixtures where cross-workstream references require them. Check asset resolution, nonempty required sections, metadata uniqueness within the assigned subset, URL encoding, and consistency of retained numeric facts. Review every record against its scenario definition and relevant event sources.

Integration owns full-catalog coverage enforcement and cross-workstream duplicate checks. Integration and final verification sub-plans own whole-catalog and production browser checks.

## Data Model

Populate exactly one complete record per assigned scenario in the shared build-only editorial manifest. Each record must contain the correct persisted scenario ID, visible name, icon, stable explicit slug, introduction, main challenge, meaningful decisions, learning outcomes, title, description, and relevant related IDs.

Read Chernobyl: Recovery's exact exported ID and definition from `src/data/ChernobylScenario.ts`; do not infer its ID from catalog position. Slugs must remain independent of display-name punctuation, including Heatwave + Drought and Chernobyl: Recovery. Related IDs must identify eligible challenges and exclude tutorials, legacy generations, custom games, and mods.

No runtime domain model, save schema, scenario identifier, or simulation data changes are required.

## API Contracts

_No content yet_

## Non-Functional Requirements

_No content yet_

## Open Questions

_No content yet_
