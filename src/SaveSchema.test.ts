import { parseSave, serializeSave } from "./SaveGame";
import { SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { createGame } from "./testing/Simulator";
import { projectAuthoredRunReference } from "./helpers/RunIdentity";

const game = createGame({ scenarioId: 101, seed: 31337 });

it.each([
  undefined,
  0,
  1,
  2,
  3,
  4,
  5,
  SAVE_SCHEMA_VERSION + 1,
  -1,
  1.5,
  "6",
  null,
])(
  "rejects an unsupported or malformed schema %p without repairing it",
  (schemaVersion) => {
    const save = { ...serializeSave(game), schemaVersion };
    expect(parseSave(save)).toBeNull();
    expect(save.schemaVersion).toBe(schemaVersion);
    expect(parseSave(serializeSave(game))).not.toBeNull();
  },
);

it("never rewrites a run or challenge from another build to current rules", () => {
  const save = JSON.parse(JSON.stringify(serializeSave(game)));
  save.game.challenge = {
    run: projectAuthoredRunReference(game.runIdentity),
    target: 400,
  };
  expect(parseSave(save)?.game.challenge).toEqual(save.game.challenge);
  save.game.runIdentity.compatibilityId = "different-rules";
  save.game.challenge.run.compatibilityId = "different-rules";
  const original = JSON.stringify(save);
  expect(parseSave(save)).toBeNull();
  expect(JSON.stringify(save)).toBe(original);
});
