import type { GameType } from "../../Types";

/** Forecasts consume economics and story state; UI logs never affect their math. */
export function forecastWorkerSnapshot(game: GameType): GameType {
  return {
    ...game,
    runIdentity: undefined,
    challenge: undefined,
    eventLog: [],
    reportedEventKeys: [],
    meaningfulDecisions: [],
  };
}
