import { ActiveWorldEventType, GameType } from "../Types";
import { generateNewTimeline } from "../reducers/Game";
import {
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "./DateTime";
import { wildfirePreparedness } from "./Wildfire";
import { TICK_MINUTES } from "../Constants";
import { CALIFORNIA_WILDFIRE_READINESS_COST } from "../data/CaliforniaWildfire";

/** The selected historical incident, while there is still time to reserve local backup. */
export function wildfirePreviewMonth(game: GameType): number | undefined {
  const preparedness = wildfirePreparedness(game);
  return preparedness && !preparedness.tooLate
    ? preparedness.fireMonth
    : undefined;
}

/**
 * Compare the same authored episode with the reservation off and on through the real forecast.
 * Neither variant changes the isolated grid demand or grants fuel again at a month boundary.
 * This is a monthly energy estimate, not a chronological simulation of generator endurance.
 */
export function previewWildfire(game: GameType, month: number) {
  const preparedness = wildfirePreparedness(game);
  if (!preparedness || month !== preparedness.fireMonth)
    throw new Error("No scheduled wildfire preparedness preview");
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (!now) throw new Error("No current simulation tick");
  const ticks = Math.ceil(
    ((month + 1) * MINUTES_PER_MONTH - game.date.minute) / TICK_MINUTES,
  );
  const run = (reserved: boolean) => {
    const change: ActiveWorldEventType = {
      key: `wildfire:${game.location.id}:preparedness:${reserved ? 999998 : 999999}`,
      definitionId: "wildfire-preparedness-preview",
      startsMinute: game.date.minute,
      endsMinute: game.date.minute,
      attributes: {
        choice: reserved ? "prepare" : "stop",
        annualCost: CALIFORNIA_WILDFIRE_READINESS_COST,
        startEffectiveness: reserved ? 1 : 0,
      },
      effects: {},
    };
    const draft = {
      ...game,
      worldEvents: {
        ...game.worldEvents,
        occurrences: [...game.worldEvents.occurrences, change],
      },
    };
    const selected = generateNewTimeline(
      draft,
      now.cash,
      now.customers,
      ticks,
    ).filter((tick) => Math.floor(tick.minute / MINUTES_PER_MONTH) === month);
    return {
      interruptedW: selected.map((tick) =>
        Math.max(0, (tick.disconnectedDemandW || 0) - (tick.localBackupW || 0)),
      ),
      summary: summarizeTimeline(selected, game.startingYear),
    };
  };
  const standard = run(false);
  const prepared = run(true);
  return {
    month,
    standard: standard.summary,
    prepared: prepared.summary,
    standardInterruptedW: standard.interruptedW,
    preparedInterruptedW: prepared.interruptedW,
  };
}
export type WildfirePreviewResult = ReturnType<typeof previewWildfire>;
