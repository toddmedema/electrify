import { GameType } from "../Types";
import { getTimeFromTimeline } from "../helpers/DateTime";

/** Live grid pressure only: forecasts and old blackout events must not make a healthy grid tense. */
export function musicIntensityForGame(game: GameType): number {
  if (!game.inGame) {
    return 0;
  }
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (!now || now.demandW <= 0) {
    return game.blackout ? 0.7 : 0;
  }
  const shortfall = Math.max(0, (now.demandW - now.supplyW) / now.demandW);
  if (shortfall > 0 || game.blackout) {
    // Even a small interruption should register. At 25% unmet demand the mix reaches its ceiling.
    return Math.min(1, 0.7 + shortfall * 1.2);
  }
  const reserveRatio =
    (now.reserveW ?? now.supplyW - now.demandW) / now.demandW;
  // Match the toolbar's 10% low-reserve boundary, building tension before an actual shortage.
  return Math.max(0, Math.min(0.5, (1 - reserveRatio / 0.1) * 0.5));
}
