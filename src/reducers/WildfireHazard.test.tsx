import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { GameType } from "../Types";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { getWildfireProfile } from "../data/WildfireProfiles";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { chooseScenarioResponse } from "./GameActions";
import gameReducer, { tickState } from "./Game";
import {
  WILDFIRE_DEFINITION_ID,
  sampleWildfireIncident,
  wildfirePreparedness,
} from "../helpers/Wildfire";

const historical = SCENARIOS.find((s) => s.id === 111)!;
function custom(seed: number): GameType {
  return createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: { ...historical, id: CUSTOM_SCENARIO_ID, name: "Custom LA" },
    seed,
  });
}
function month(game: GameType): GameType {
  const decision = pendingScenarioChoice(game);
  const state = decision
    ? cloneDeep(
        gameReducer(
          game,
          chooseScenarioResponse({
            decisionId: decision.id,
            optionId: decision.options.find(
              (o) => o.cost(game.difficulty) === 0,
            )!.id,
          }),
        ),
      )
    : game;
  const target = state.date.monthsElapsed + 1;
  while (state.date.monthsElapsed < target) tickState(state);
  return state;
}
const profile = getWildfireProfile("LA")!;
const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((value) =>
  Array.from({ length: 12 }, (_, m) => m).some((monthsElapsed) =>
    sampleWildfireIncident({
      profile,
      seed: value,
      locationId: "LA",
      monthsElapsed,
      startingYear: historical.startingYear,
    }),
  ),
)!;
function firstSmoke() {
  let state = custom(seed);
  for (let m = 0; m < 24; m++) {
    state = month(state);
    const event = state.worldEvents.active.find(
      (e) => e.definitionId === WILDFIRE_DEFINITION_ID,
    );
    if (event) return { state, event };
  }
  throw new Error("Observed heavy smoke year did not produce a smoke event");
}

describe("historical smoke integration", () => {
  it("applies only an hourly solar effect and names the affected fuel", () => {
    const { state, event } = firstSmoke();
    expect(Object.keys(event.effects)).toEqual([
      "solarIrradianceMultipliersByHour",
    ]);
    expect(
      Object.keys(event.effects.solarIrradianceMultipliersByHour!),
    ).toHaveLength(8);
    expect(event.effects.solarIrradianceMultipliersByHour!["10"]).toBeLessThan(
      1,
    );
    expect(
      event.effects.solarIrradianceMultipliersByHour!["9"],
    ).toBeUndefined();
    expect(event.message).toContain("Solar receives");
    expect(event.attributes.heavySmokeDays).toBeGreaterThan(0);
    expect(event.attributes.sourceYear).toBeGreaterThanOrEqual(2017);
    expect(
      state.worldEvents.occurrences.filter((e) => e.key === event.key),
    ).toHaveLength(1);
    expect(
      state.eventLog.filter((e) => e.storyPhaseKey === event.key),
    ).toHaveLength(1);
    expect(wildfirePreparedness(state)).toBeUndefined();
  });

  it("preserves onset facts across resumed rollovers and expires at the month boundary", () => {
    const { state, event } = firstSmoke();
    let next = month(cloneDeep(state));
    expect(next.worldEvents.active.some((e) => e.key === event.key)).toBe(
      false,
    );
    next = month(next);
    expect(
      next.worldEvents.occurrences.filter((e) => e.key === event.key),
    ).toEqual([event]);
    expect(event.endsMinute - event.startsMinute).toBe(MINUTES_PER_MONTH);
  });

  it("replays the same observations independently of fleet order and preparedness", () => {
    const { state, event } = firstSmoke();
    const draft = cloneDeep(custom(seed));
    draft.facilities.reverse();
    let repeated = draft;
    while (repeated.date.monthsElapsed < state.date.monthsElapsed)
      repeated = month(repeated);
    expect(
      repeated.worldEvents.occurrences.find((e) => e.key === event.key),
    ).toEqual(event);
  });

  it("does not infer smoke risk for unknown cities or overlap the authored mission", () => {
    let authored = createGame({ scenarioId: 111, seed });
    for (let m = 0; m < 12; m++) authored = month(authored);
    expect(
      authored.worldEvents.occurrences.filter(
        (e) => e.definitionId === WILDFIRE_DEFINITION_ID,
      ),
    ).toEqual([]);
    const unknown = custom(seed);
    unknown.location.id = "unprofiled";
    expect(wildfirePreparedness(unknown)).toBeUndefined();
    for (let m = 0; m < 12; m++) month(unknown);
    expect(
      unknown.worldEvents.occurrences.filter(
        (e) => e.definitionId === WILDFIRE_DEFINITION_ID,
      ),
    ).toEqual([]);
  });
});
