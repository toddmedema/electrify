import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";

test("a current native journal remains required in saves", () => {
  const game = createGame({ scenarioId: 111, seed: 12345 });
  runMonths(game, 25);
  const original = cloneDeep(serializeSave(game));
  expect(parseSave(original)).not.toBeNull();
  const missing = cloneDeep(original);
  const key = "story:111:wildfire-intertie:readiness";
  expect(
    missing.game.worldEvents.occurrences.some((event) => event.key === key),
  ).toBe(true);
  missing.game.worldEvents.occurrences =
    missing.game.worldEvents.occurrences.filter((event) => event.key !== key);
  missing.game.worldEvents.active = missing.game.worldEvents.active.filter(
    (event) => event.key !== key,
  );
  expect(parseSave(missing)).toBeNull();
  expect(parseSave(original)).not.toBeNull();
});
