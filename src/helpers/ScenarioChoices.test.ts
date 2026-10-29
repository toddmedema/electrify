import { SCENARIO_CHOICE_RULES } from "../data/ScenarioChoiceRules";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { SCENARIOS } from "../data/Scenarios";
import reducer from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import {
  pendingScenarioChoice,
  scenarioChoiceDescription,
  validScenarioResponse,
} from "./ScenarioChoices";
import { createGame } from "../testing/Simulator";
import { DifficultyType, ScenarioChoiceType } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";

test("choice descriptions include actual funding and difficulty-specific costs", () => {
  const dataCenter = SCENARIO_CHOICES.find(
    (choice) => choice.scenarioId === 106,
  )!;
  expect(scenarioChoiceDescription(dataCenter.options[0], "Manager")).toBe(
    "Receive $15M to connect all 100 MW in January 2026.",
  );
  const pricedOption = {
    id: "protection",
    label: "Fund protection",
    message: "Funded",
    cost: (difficulty: DifficultyType) =>
      difficulty === "Intern" ? 200000 : 2500000,
    description: "Spend {cost} to protect plant output.",
  };
  expect(scenarioChoiceDescription(pricedOption, "Intern")).toBe(
    "Spend $200k to protect plant output.",
  );
  expect(scenarioChoiceDescription(pricedOption, "CEO")).toBe(
    "Spend $2.5M to protect plant output.",
  );
});

test("other scenarios can queue timed choices using only authored definitions", () => {
  const game = createGame({ scenarioId: 101 });
  const first: ScenarioChoiceType = {
    id: "new-policy",
    scenarioId: 101,
    atMonth: 2,
    title: "Policy",
    message: "Choose",
    options: [{ id: "yes", label: "Yes", message: "Accepted", cost: () => 0 }],
  };
  const second = { ...first, id: "follow-up" };
  expect(pendingScenarioChoice(game, [first, second])).toBeUndefined();
  game.date.minute = 2 * MINUTES_PER_MONTH;
  expect(pendingScenarioChoice(game, [first, second])).toBe(first);
  game.worldEvents.occurrences.push({
    key: first.id,
    definitionId: first.id,
    startsMinute: game.date.minute,
    endsMinute: game.date.minute,
    attributes: { choice: "yes" },
    effects: {},
  });
  expect(pendingScenarioChoice(game, [first, second])).toBe(second);
  game.storyEffectsDisabled = true;
  expect(pendingScenarioChoice(game, [first])).toBeUndefined();
});

test.each([null, "prepare", {}, { decisionId: 1, optionId: "yes" }])(
  "rejects malformed response %p",
  (value) => {
    expect(validScenarioResponse(value)).toBe(false);
  },
);

test("generic reducer accepts another scenario's authored option without wildfire wiring", () => {
  const scenarioIndex = SCENARIOS.findIndex((scenario) => scenario.id === 101);
  const originalScenario = SCENARIOS[scenarioIndex];
  const definition: ScenarioChoiceType = {
    id: "story:101:test-policy:test-other-scenario",
    scenarioId: 101,
    atMonth: 0,
    title: "New policy",
    message: "Choose a policy",
    options: [
      { id: "adopt", label: "Adopt", message: "Policy adopted", cost: () => 0 },
    ],
  };
  SCENARIO_CHOICES.push(definition);
  SCENARIO_CHOICE_RULES.push({
    scenarioId: 101,
    arcId: "test-policy",
    choice: {
      id: "test-other-scenario",
      dueMonth: 1,
      title: definition.title,
      prompt: definition.message,
      options: [
        {
          id: "adopt",
          label: "Adopt",
          description: "Adopt policy",
          message: "Policy adopted",
          costDollars: 0,
        },
        {
          id: "retain",
          label: "Retain",
          description: "Retain policy",
          message: "Policy retained",
          costDollars: 0,
        },
      ],
    },
  });
  try {
    // Compiled catalog rules bind at launch. Isolate the temporary authored
    // definition from earlier games and leave their cached snapshots intact.
    SCENARIOS[scenarioIndex] = { ...originalScenario };
    const game = createGame({ scenarioId: 101 });
    expect(pendingScenarioChoice(game)?.id).toBe(definition.id);
    expect(
      reducer(
        game,
        chooseScenarioResponse({
          decisionId: definition.id,
          optionId: "unknown",
        }),
      ),
    ).toBe(game);
    const chosen = reducer(
      game,
      chooseScenarioResponse({ decisionId: definition.id, optionId: "adopt" }),
    );
    expect(
      chosen.worldEvents.occurrences.find(
        (event) => event.key === definition.id,
      )?.attributes.choice,
    ).toBe("adopt");
    expect(pendingScenarioChoice(chosen)).toBeUndefined();
  } finally {
    SCENARIOS[scenarioIndex] = originalScenario;
    SCENARIO_CHOICES.pop();
    SCENARIO_CHOICE_RULES.pop();
  }
});
