import { DIFFICULTIES } from "../Constants";
import { DifficultyType } from "../Types";

/** Persisted difficulty names must resolve to an authored set of simulation multipliers. */
export function isValidDifficulty(value: unknown): value is DifficultyType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DIFFICULTIES, value)
  );
}
