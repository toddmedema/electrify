import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  getNextTutorial,
  getScenario,
  SCENARIOS,
  TUTORIALS,
} from "./Scenarios";
import { ScenarioType } from "../Types";

describe("getScenario", () => {
  it("finds an authored scenario by id", () => {
    const authored = SCENARIOS[SCENARIOS.length - 1];
    expect(getScenario(authored.id)).toBe(authored);
  });

  it("returns the custom scenario for the custom id", () => {
    const custom = {
      ...DEFAULT_CUSTOM_SCENARIO,
      startingYear: 1990,
    } as ScenarioType;
    expect(getScenario(CUSTOM_SCENARIO_ID, custom)).toBe(custom);
  });

  it("ignores the custom scenario when asked for an authored one", () => {
    const authored = SCENARIOS[0];
    expect(getScenario(authored.id, DEFAULT_CUSTOM_SCENARIO)).toBe(authored);
  });

  it("finds nothing for a custom game that has no config", () => {
    expect(getScenario(CUSTOM_SCENARIO_ID)).toBeUndefined();
  });

  it("finds nothing for an id that doesn't exist", () => {
    expect(getScenario(-1)).toBeUndefined();
  });

  // Every custom game reuses one id, so an authored scenario taking it would be resolved as
  // whatever the player last set up
  it("keeps the custom id out of the authored scenarios", () => {
    expect(
      SCENARIOS.some((s: ScenarioType) => s.id === CUSTOM_SCENARIO_ID),
    ).toBe(false);
  });
});

describe("getNextTutorial", () => {
  it("follows the authored order", () => {
    expect(getNextTutorial(TUTORIALS[0].id)).toBe(TUTORIALS[1]);
  });

  it("finds nothing after the last tutorial", () => {
    expect(getNextTutorial(TUTORIALS[TUTORIALS.length - 1].id)).toBeUndefined();
  });

  // Which is what both callers rely on to decide whether to offer one at all
  it("finds nothing for a scenario that isn't a tutorial", () => {
    const scenario = SCENARIOS.find((s: ScenarioType) => !s.tutorialSteps);
    expect(getNextTutorial((scenario as ScenarioType).id)).toBeUndefined();
    expect(getNextTutorial(CUSTOM_SCENARIO_ID)).toBeUndefined();
  });
});
