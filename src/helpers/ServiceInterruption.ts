import { GAME_TO_REAL_YEARS, DAYS_PER_MONTH } from "../Constants";
import { WorldEventEffectsType } from "../Types";

/** Engine energy denominator: one representative day integrates to 730 real hours. */
export const SERVICE_MONTH_HOURS = 24 * DAYS_PER_MONTH * GAME_TO_REAL_YEARS;

/**
 * Energy-equivalent local delivery loss, separate from generation adequacy.
 * Emergency backup has a finite monthly fuel/energy budget. This monthly model
 * does not claim to simulate individual feeders or battery endurance through a real outage.
 */
export function serviceInterruption(
  demandW: number,
  effects: WorldEventEffectsType,
) {
  const disconnectedDemandW =
    demandW * (effects.serviceInterruptionFraction ?? 0);
  return {
    connectedDemandW: demandW - disconnectedDemandW,
    disconnectedDemandW,
    localBackupW: Math.min(
      disconnectedDemandW,
      (effects.localBackupWhPerMonth ?? 0) / SERVICE_MONTH_HOURS,
    ),
  };
}
