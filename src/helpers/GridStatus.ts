import type { GameType, TickPresentFutureType } from "../Types";
import { isStorage } from "../Types";
import { formatWatts } from "./Format";
import { facilityPermanentlyShutdown } from "./Financials";
import {
  retrofitOutputMultiplier,
  facilityHazardStatus,
  HAIL_DEFINITION_ID,
  COLD_DEFINITION_ID,
} from "./Hazards";
import { storyOutputMultiplier } from "./Story";
import { combineStoryEffects } from "../data/WorldEvents";

export type GridHealthState =
  "stable" | "low-reserve" | "at-limit" | "blackout";

/** The reducer includes ramp, water and storage limits in this available cushion. */
export function reserveCapacityW(
  _game: GameType,
  now: TickPresentFutureType,
): number {
  return now.reserveW ?? now.supplyW - now.demandW;
}

/** Current operating reserve must never be replaced with a forecast quantity. */
export function getGridHealth(game: GameType, now: TickPresentFutureType) {
  const reserveW = Math.max(0, reserveCapacityW(game, now));
  const state: GridHealthState =
    now.supplyW < now.demandW
      ? "blackout"
      : reserveW === 0
        ? "at-limit"
        : now.demandW > 0 && reserveW / now.demandW <= 0.1
          ? "low-reserve"
          : "stable";
  const label = {
    blackout: "Shortage",
    "at-limit": "At limit",
    "low-reserve": "Low reserve",
    stable: "Stable",
  }[state];
  const watts = state === "blackout" ? now.demandW - now.supplyW : reserveW;
  const metric = `${watts === 0 ? "0MW" : formatWatts(watts)} ${state === "blackout" ? "short" : "reserve"}`;
  return { state, label, watts, metric, announcement: `${label}.` };
}

export function stableGridSummary(
  game: GameType,
  now: TickPresentFutureType,
): string {
  return `Stable, ${formatWatts(now.demandW)} demand met with ${formatWatts(Math.max(0, reserveCapacityW(game, now)))} reserve`;
}

/** Stored energy in operable storage, rather than installed capacity or inaccessible charge. */
export function readyStorage(game: GameType) {
  const minute = game.date.minute;
  const effects = combineStoryEffects(
    game.worldEvents.active.filter(
      (event) =>
        minute >= event.startsMinute &&
        minute < event.endsMinute &&
        event.definitionId !== HAIL_DEFINITION_ID &&
        event.definitionId !== COLD_DEFINITION_ID,
    ),
  );
  let storedWh = 0;
  let dischargingW = 0;
  for (const facility of game.facilities) {
    if (
      !isStorage(facility) ||
      facility.paused ||
      facility.yearsToBuildLeft > 0 ||
      facilityPermanentlyShutdown(facility, minute) ||
      retrofitOutputMultiplier(facility, minute) <= 0 ||
      storyOutputMultiplier(facility, effects, minute) <= 0 ||
      (facilityHazardStatus(game, facility)?.availableFraction ?? 1) <= 0
    )
      continue;
    storedWh += Math.max(0, facility.currentWh);
    // Measured output; nameplate capacity is not a claim of available discharge.
    dischargingW += Math.max(0, facility.currentW);
  }
  return { storedWh, dischargingW };
}
