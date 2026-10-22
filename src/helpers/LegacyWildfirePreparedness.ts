import type {
  ActiveWorldEventType,
  GameType,
  ScenarioChoiceType,
} from "../Types";
import { DIFFICULTIES } from "../Constants";
import {
  MINUTES_PER_MONTH,
  summarizeHistory,
  summarizeTimeline,
} from "./DateTime";

/** Only detached old imported rules retain this lifecycle; current native/custom play does not. */
export function isLegacyWildfireProgramGame(game: GameType): boolean {
  const rules = game.customScenario?.mod?.rules;
  return (
    game.scenarioId === 999 &&
    !game.storyEffectsDisabled &&
    rules?.namespace?.kind === "mod" &&
    !!rules.arcEvents?.some(
      (event) =>
        event.source?.scenarioId === 111 &&
        event.source.arcId === "california-wildfire-2025" &&
        event.protection?.kind === "wildfirePreparedness",
    )
  );
}

/** Array order breaks ties between old program changes recorded in the same minute. */
export function legacyWildfirePreparednessChange(
  occurrences: readonly ActiveWorldEventType[],
  locationId: string,
  minute: number,
): ActiveWorldEventType | undefined {
  for (let index = occurrences.length - 1; index >= 0; index--) {
    const change = occurrences[index];
    if (
      !change.key.startsWith(`wildfire:${locationId}:preparedness:`) ||
      change.startsMinute > minute
    )
      continue;
    return change;
  }
  return undefined;
}

/** Read protection directly from the saved program's fixed receipt terms. */
export function legacyWildfirePreparednessEffectiveness(
  occurrences: readonly ActiveWorldEventType[],
  locationId: string,
  minute: number,
): number {
  const change = legacyWildfirePreparednessChange(
    occurrences,
    locationId,
    minute,
  );
  if (!change) return 0;
  const from = Number(change.attributes.startEffectiveness);
  const to = change.attributes.choice === "prepare" ? 1 : 0;
  const progress = Math.min(
    1,
    Math.max(0, (minute - change.startsMinute) / (12 * MINUTES_PER_MONTH)),
  );
  return from + (to - from) * progress;
}

/** Existing receipt terms are fixed until the player stops and restarts the saved program. */
export function legacyWildfirePreparednessAnnualCost(
  occurrences: readonly ActiveWorldEventType[],
  locationId: string,
  minute: number,
): number {
  const change = legacyWildfirePreparednessChange(
    occurrences,
    locationId,
    minute,
  );
  return change?.attributes.choice === "prepare"
    ? Number(change.attributes.annualCost || 0)
    : 0;
}

export interface LegacyWildfirePreparedness {
  active: boolean;
  annualCost: number;
  effectiveness: number;
  choice: ScenarioChoiceType;
}

/** Restore the saved program's original budget, ramp and explicit start/stop terms. */
export function legacyWildfirePreparedness(
  game: GameType,
): LegacyWildfirePreparedness | undefined {
  if (!isLegacyWildfireProgramGame(game)) return undefined;
  const changes = game.worldEvents.occurrences.filter((event) =>
    event.key.startsWith(`wildfire:${game.location.id}:preparedness:`),
  );
  const nextChange = changes.reduce(
    (next, event) => Math.max(next, Number(event.key.split(":").pop()) + 1),
    0,
  );
  const current = legacyWildfirePreparednessChange(
    changes,
    game.location.id,
    game.date.minute,
  );
  const active = current?.attributes.choice === "prepare";
  const recent = game.monthlyHistory.slice(0, 12);
  const monthlyDemandWh = recent.length
    ? summarizeHistory(recent).demandWh / recent.length
    : summarizeTimeline(
        game.timeline.filter(
          (tick) =>
            Math.floor(tick.minute / MINUTES_PER_MONTH) ===
            Math.floor((game.timeline[0]?.minute ?? 0) / MINUTES_PER_MONTH),
        ),
        game.startingYear,
      ).demandWh;
  const annualCost = active
    ? Number(current.attributes.annualCost)
    : Math.round(
        ((3 * monthlyDemandWh) / 1e6) * DIFFICULTIES[game.difficulty].buildCost,
      );
  return {
    active,
    annualCost,
    effectiveness: legacyWildfirePreparednessEffectiveness(
      changes,
      game.location.id,
      game.date.minute,
    ),
    choice: {
      id: `wildfire:${game.location.id}:preparedness:${nextChange}`,
      scenarioId: game.scenarioId,
      atMonth: game.date.monthsElapsed,
      title: "Wildfire preparedness",
      message:
        "Prepare crews and backup equipment for your selected wildfire scenario. Protection ramps up over 12 months.",
      options: [
        {
          id: active ? "stop" : "prepare",
          label: active ? "Turn off preparedness" : "Start preparedness",
          cost: () => 0,
          description: active
            ? "Stop spending now; remaining protection fades linearly over 12 months."
            : "Ongoing annual budget, billed monthly. Benefits ramp up over 12 months; stays on until turned off.",
          message: active
            ? "Wildfire preparedness turned off. Spending stops now; protection fades over 12 months."
            : "Wildfire preparedness started. Benefits ramp up over 12 months; its annual budget is billed monthly until turned off.",
        },
      ],
    },
  };
}
