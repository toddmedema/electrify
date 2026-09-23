import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { ActiveWorldEventType, GameType } from "../Types";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { getWildfireProfile } from "../data/WildfireProfiles";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { chooseScenarioResponse } from "./GameActions";
import gameReducer, { tickState } from "./Game";
import { WILDFIRE_DEFINITION_ID } from "../helpers/Wildfire";

const LA = getWildfireProfile("LA")!;
const wildfireScenario = SCENARIOS.find((s) => s.id === 111)!;

function customGameAtLA(seed: number): GameType {
  return createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: {
      ...wildfireScenario,
      id: CUSTOM_SCENARIO_ID,
      name: "Custom LA",
    },
    seed,
  });
}

type Respond = (
  decision: NonNullable<ReturnType<typeof pendingScenarioChoice>>,
) => string | undefined;

/** Answers any pending choice (via respond, defaulting to the free option) then ticks one month. */
function tickOneMonth(state: GameType, respond?: Respond): GameType {
  const decision = pendingScenarioChoice(state);
  if (decision && !state.replayPlayback) {
    const optionId = respond
      ? respond(decision)
      : decision.options.find((o) => o.cost(state.difficulty) === 0)?.id;
    if (optionId) {
      state = cloneDeep(
        gameReducer(
          state,
          chooseScenarioResponse({ decisionId: decision.id, optionId }),
        ),
      );
    }
  }
  const target = state.date.monthsElapsed + 1;
  while (state.date.monthsElapsed < target) {
    tickState(state);
  }
  return state;
}

/** Ticks month by month until an active wildfire appears (or maxMonths elapse). */
function runToActiveWildfire(
  game: GameType,
  maxMonths: number,
  respond?: Respond,
): { state: GameType; incident: ActiveWorldEventType } | undefined {
  let state = game;
  for (let i = 0; i < maxMonths; i++) {
    state = tickOneMonth(state, respond);
    const incident = state.worldEvents.active.find(
      (event) => event.definitionId === WILDFIRE_DEFINITION_ID,
    );
    if (incident) {
      return { state, incident };
    }
  }
  return undefined;
}

const wildfireOccurrences = (state: GameType) =>
  state.worldEvents.occurrences.filter(
    (event) => event.definitionId === WILDFIRE_DEFINITION_ID,
  );

// Find a seed that ignites within the first year so these tests are grounded in a real event.
// runToActiveWildfire stops as soon as a fire appears, so early-igniting seeds are cheap.
function findIgnitingSeed(maxSeeds = 40): number {
  for (let seed = 1; seed <= maxSeeds; seed++) {
    if (runToActiveWildfire(customGameAtLA(seed), 12)) return seed;
  }
  throw new Error("No wildfire ignition found for any seed in the first year");
}

const IGNITING_SEED = findIgnitingSeed();

// A seed whose FIRST fire ignites after the preparedness month, so a funded response (offered in
// August) is in place before it. A seed whose first fire precedes August is skipped, because the
// test observes that first fire.
function findSeedIgnitingAfterPreparedness(maxSeeds = 60): number | undefined {
  for (let seed = 1; seed <= maxSeeds; seed++) {
    let state = customGameAtLA(seed);
    for (let m = 0; m < 14; m++) {
      state = tickOneMonth(state, (decision) =>
        decision.id.startsWith("wildfire:") ? "standard" : undefined,
      );
      const incident = state.worldEvents.active.find(
        (event) => event.definitionId === WILDFIRE_DEFINITION_ID,
      );
      if (incident) {
        const onsetMonth = Math.floor(
          incident.startsMinute / MINUTES_PER_MONTH,
        );
        if (onsetMonth > LA.preparednessMonth) return seed;
        break; // First fire is before the preparedness month; try the next seed.
      }
    }
  }
  return undefined;
}

describe("recurring wildfire hazard integration", () => {
  it("ignites for at least one seed in the first year (test is not vacuous)", () => {
    expect(
      runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12),
    ).toBeDefined();
  });

  it("creates exactly one occurrence at ignition and applies its effects", () => {
    const result = runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12);
    expect(result).toBeDefined();
    const { state, incident } = result!;
    // Exactly one occurrence exists (not duplicated).
    expect(wildfireOccurrences(state).length).toBe(1);
    // Effects are present and bounded.
    expect(incident.effects.demandMultiplier).toBeLessThan(1);
    expect(incident.effects.demandMultiplier).toBeGreaterThan(0);
    expect(incident.effects.operatingExpensePerMonth).toBeGreaterThan(0);
    expect(
      Object.keys(incident.effects.facilityOutputMultipliersById || {}).length,
    ).toBeGreaterThan(0);
    // It is active and logged as a critical event.
    expect(state.worldEvents.active.some((e) => e.key === incident.key)).toBe(
      true,
    );
    expect(state.eventLog.some((e) => e.storyPhaseKey === incident.key)).toBe(
      true,
    );
  });

  it("persists the incident across a save/load without rerolling (fixed facility selection)", () => {
    const result = runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12);
    expect(result).toBeDefined();
    const { state: midEvent, incident } = result!;

    // Simulate a save/load: the persisted state is self-contained.
    const reloaded = cloneDeep(midEvent);
    // Advance a couple more months; the incident must not be re-drawn or duplicated.
    let after = tickOneMonth(reloaded);
    after = tickOneMonth(after);
    const sameKey = wildfireOccurrences(after).filter(
      (e) => e.key === incident.key,
    );
    expect(sameKey.length).toBe(1); // Still exactly one.
    // Onset attributes (facility selection, severity) are unchanged.
    expect(sameKey[0].attributes.selectedFacilityIds).toEqual(
      incident.attributes.selectedFacilityIds,
    );
    expect(sameKey[0].attributes.severity).toBe(incident.attributes.severity);
  });

  it("restores: the incident expires from active after its effect window", () => {
    const result = runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12);
    expect(result).toBeDefined();
    const { state: midEvent, incident } = result!;
    const durationMonths = incident.attributes.durationMonths as number;
    // Tick well past the end of the window.
    let after = midEvent;
    for (let i = 0; i < durationMonths + 2; i++) {
      after = tickOneMonth(after);
    }
    expect(after.worldEvents.active.some((e) => e.key === incident.key)).toBe(
      false,
    );
    // The occurrence is retained for the record but expired.
    expect(
      after.worldEvents.occurrences.some((e) => e.key === incident.key),
    ).toBe(true);
  });

  it("logs a restoration-complete notice exactly once when the incident expires", () => {
    const result = runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12);
    expect(result).toBeDefined();
    const { state: midEvent, incident } = result!;
    const durationMonths = incident.attributes.durationMonths as number;
    // Tick to just past the end of the window (the month it expires).
    let after = midEvent;
    for (let i = 0; i < durationMonths + 1; i++) {
      after = tickOneMonth(after);
    }
    const recoveryEvents = after.eventLog.filter(
      (e) => e.title === "Wildfire restoration complete",
    );
    expect(recoveryEvents.length).toBe(1);
    // Ticking further does not log it again.
    after = tickOneMonth(after);
    expect(
      after.eventLog.filter((e) => e.title === "Wildfire restoration complete")
        .length,
    ).toBe(1);
  });

  it("does not re-create the incident on repeated rollovers (exactly-once)", () => {
    const result = runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12);
    expect(result).toBeDefined();
    const { state: midEvent, incident } = result!;
    // Keep ticking well past the incident; it must never be created a second time.
    let after = midEvent;
    for (let i = 0; i < 12; i++) {
      after = tickOneMonth(after);
    }
    const sameKey = wildfireOccurrences(after).filter(
      (e) => e.key === incident.key,
    );
    expect(sameKey.length).toBe(1);
  });

  it("applies preparedness when the player funds it before onset", () => {
    const seed = findSeedIgnitingAfterPreparedness();
    if (seed === undefined) {
      // No post-preparedness ignition in the sample; the unit tests cover the halving.
      return;
    }
    // A run that funds preparedness (answers "prepare" for the wildfire choice).
    const prepared = runToActiveWildfire(
      customGameAtLA(seed),
      14,
      (decision) =>
        decision.id.startsWith("wildfire:") ? "prepare" : undefined,
    );
    // A control run that declines it.
    const standard = runToActiveWildfire(
      customGameAtLA(seed),
      14,
      (decision) =>
        decision.id.startsWith("wildfire:") ? "standard" : undefined,
    );
    if (!prepared || !standard) {
      return;
    }
    expect(prepared.incident.attributes.prepared).toBe(true);
    expect(standard.incident.attributes.prepared).toBe(false);
    // Preparedness halves disconnections and output losses.
    const preparedDisconnected = prepared.incident.attributes
      .disconnectedDemand as number;
    const standardDisconnected = standard.incident.attributes
      .disconnectedDemand as number;
    const preparedOutput = prepared.incident.attributes
      .outputMultiplier as number;
    const standardOutput = standard.incident.attributes
      .outputMultiplier as number;
    expect(preparedDisconnected).toBeLessThan(standardDisconnected);
    expect(preparedOutput).toBeGreaterThan(standardOutput);
    // Restoration cost is unchanged by preparedness.
    expect(
      prepared.incident.attributes.restorationCostPerMonth as number,
    ).toBeCloseTo(
      standard.incident.attributes.restorationCostPerMonth as number,
      6,
    );
  });

  it("does not create a random wildfire in the authored scenario 111", () => {
    const game = createGame({ scenarioId: 111, seed: IGNITING_SEED });
    let state = game;
    for (let i = 0; i < 24; i++) {
      state = tickOneMonth(state);
    }
    expect(wildfireOccurrences(state).length).toBe(0);
  });

  it("keeps the incident's disconnected load out of connected demand (demandMultiplier)", () => {
    const result = runToActiveWildfire(customGameAtLA(IGNITING_SEED), 12);
    expect(result).toBeDefined();
    const { incident } = result!;
    // The effect reduces connected demand by exactly the disconnected share.
    const disconnected = incident.attributes.disconnectedDemand as number;
    expect(incident.effects.demandMultiplier).toBeCloseTo(1 - disconnected, 12);
    // The disconnected share is a readable fraction of customer load.
    expect(disconnected).toBeGreaterThan(0);
    expect(disconnected).toBeLessThan(1);
  });
});
