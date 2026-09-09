import type { GameType, PolicyId, PolicyTier } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";

/** Start one hour before the forecast peak, keeping it inside the four-hour window. */
export function suggestedPolicyStartHour(game: GameType): number {
  const nextMonth = (game.date.monthsElapsed + 1) * MINUTES_PER_MONTH;
  const upcoming = game.timeline.filter((tick) => tick.minute >= nextMonth);
  const forecast = upcoming.length
    ? upcoming.filter((tick) => tick.minute < nextMonth + MINUTES_PER_MONTH)
    : game.timeline.filter((tick) => tick.minute >= game.date.minute);
  const peak = forecast.reduce<(typeof forecast)[number] | undefined>(
    (highest, tick) =>
      !highest || tick.demandW > highest.demandW ? tick : highest,
    undefined,
  );
  return peak
    ? (Math.floor((peak.minute % MINUTES_PER_MONTH) / 60) + 23) % 24
    : 17;
}

export function policyWindowLabel(startHour: number, hours = 4): string {
  const clock = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;
  return `${clock(startHour)}–${clock(startHour + hours)}${startHour + hours >= 24 ? " (next day)" : ""}`;
}

export function policyChoiceLabel(
  id: PolicyId,
  choice?: { tier: PolicyTier; startHour?: number },
): string {
  if (!choice || choice.tier === "Off") return "Off";
  return id === "timeOfUse" || id === "curtailment"
    ? `On · ${policyWindowLabel(choice.startHour ?? 17)}`
    : choice.tier;
}
