import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import type { GameType } from "../Types";

/** The save as storage would return it, so only serializable state can survive. */
export const roundTrip = (game: GameType) =>
  JSON.parse(JSON.stringify(serializeSave(game)));

/**
 * Applies each edit to a detached copy of an intact run and expects strict save validation to
 * reject it, then proves the original still loads. `edits` is a table of [name, edit].
 */
export function expectSaveForgeries(
  game: GameType,
  edits: [string, (copy: GameType) => void][],
) {
  expect(validScenarioRuleState(game)).toBe(true);
  expect(parseSave(roundTrip(game))).not.toBeNull();
  for (const [name, edit] of edits) {
    const forged = cloneDeep(game);
    edit(forged);
    expect({ name, valid: validScenarioRuleState(forged) }).toEqual({
      name,
      valid: false,
    });
    expect({ name, save: parseSave(roundTrip(forged)) }).toEqual({
      name,
      save: null,
    });
  }
  expect(validScenarioRuleState(game)).toBe(true);
  expect(parseSave(roundTrip(game))).not.toBeNull();
}
