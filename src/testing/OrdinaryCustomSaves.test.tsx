import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "./Simulator";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";

test("ordinary custom saves round trip without accepting stored native rules", () => {
  const game = createGame({
    scenarioId: 999,
    scenario: DEFAULT_CUSTOM_SCENARIO,
  });
  const source = cloneDeep(serializeSave(game));
  expect(parseSave(source)?.game.customScenario).toEqual(game.customScenario);
  const forged = cloneDeep(source);
  Object.assign(forged.game.customScenario!, { rules: {} });
  expect(parseSave(forged)).toBeNull();
  expect(parseSave(source)).not.toBeNull();
});
