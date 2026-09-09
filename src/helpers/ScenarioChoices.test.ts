import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import reducer from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import {
  pendingScenarioChoice,
  validScenarioResponse,
} from "./ScenarioChoices";
import { createGame } from "../testing/Simulator";
import { ScenarioChoiceType } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";

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
  const game = createGame({ scenarioId: 101 });
  const definition: ScenarioChoiceType = {
    id: "test-other-scenario",
    scenarioId: 101,
    atMonth: 0,
    title: "New policy",
    message: "Choose a policy",
    options: [
      { id: "adopt", label: "Adopt", message: "Policy adopted", cost: () => 0 },
    ],
  };
  SCENARIO_CHOICES.push(definition);
  try {
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
    expect(chosen.replayLog?.at(-1)?.type).toBe("chooseScenarioResponse");
  } finally {
    SCENARIO_CHOICES.pop();
  }
});
