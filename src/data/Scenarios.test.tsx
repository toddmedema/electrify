import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  getNextTutorial,
  getScenario,
  SCENARIOS,
  TUTORIALS,
} from "./Scenarios";
import { ScenarioType } from "../Types";
import { render, screen } from "@testing-library/react";

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

describe("tutorial mission metadata", () => {
  it("gives every tutorial a mission name, icon, and summary", () => {
    TUTORIALS.forEach((tutorial, index) => {
      expect(tutorial.name).toMatch(new RegExp(`^Mission ${index + 1}: `));
      expect(tutorial.icon).toBeTruthy();
      expect(tutorial.summary).toBeTruthy();
    });
  });

  it("introduces Oil's fixed and output-dependent O&M", () => {
    const generatorsMission = TUTORIALS.find(
      (tutorial) => tutorial.name === "Mission 2: Generators",
    )!;
    render(generatorsMission.tutorialSteps![1].content);

    expect(
      screen.getByText(/Oil pays fixed O&M even when idle/),
    ).toHaveTextContent("variable O&M whenever it generates");
  });

  it("gives every mission one deterministic unguided capstone", () => {
    TUTORIALS.forEach((tutorial) => {
      expect(tutorial.seed).toEqual(expect.any(Number));
      const capstones = tutorial.tutorialSteps!.filter((step) => step.capstone);
      expect(capstones).toHaveLength(1);
      expect(capstones[0].target).toBeUndefined();
      expect(capstones[0].hint).toBeTruthy();
    });
  });
});

describe("authored scenario briefings", () => {
  it("gives every scored scenario a reusable story, stakes, and target", () => {
    SCENARIOS.filter((scenario) => !scenario.tutorialSteps).forEach(
      (scenario) => {
        expect(scenario.briefing).toEqual(
          expect.objectContaining({
            tone: expect.any(String),
            fantasy: expect.any(String),
            objective: expect.any(String),
            constraint: expect.any(String),
            threat: expect.any(String),
            target: expect.any(String),
          }),
        );
      },
    );
  });
});
