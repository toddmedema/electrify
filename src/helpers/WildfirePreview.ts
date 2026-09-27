import {
  ActiveWorldEventType,
  GameType,
  TickPresentFutureType,
} from "../Types";
import { generateNewTimeline } from "../reducers/Game";
import {
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "./DateTime";
import { buildStorySnapshot } from "./Story";
import {
  typicalWildfireIncident,
  WILDFIRE_DEFINITION_ID,
  wildfireIncidentEffects,
  WildfireIncidentType,
  wildfirePreparedness,
  wildfirePreparednessEffectiveness,
  WILDFIRE_PREPAREDNESS_RAMP_MONTHS,
} from "./Wildfire";
import { getScenario } from "../data/Scenarios";
import { TICK_MINUTES } from "../Constants";

/**
 * The next season month a preview illustrates: its highest-risk month,
 * earliest first on a tie. Undefined when the next season starts after the run ends.
 */
export function wildfirePreviewMonth(game: GameType): number | undefined {
  const preparedness = wildfirePreparedness(game);
  if (!preparedness || preparedness.tooLate) return undefined;
  const { profile, season } = preparedness;
  const endMonth = Math.min(
    season.endMonth,
    getScenario(game.scenarioId, game.customScenario)?.durationMonths ??
      Infinity,
  );
  let best: number | undefined;
  for (let month = season.startMonth; month < endMonth; month++) {
    const weight = profile.monthlyWeights[month % 12] ?? 0;
    if (best === undefined || weight > profile.monthlyWeights[best % 12])
      best = month;
  }
  return best;
}

/**
 * Simulates a typical wildfire in one month through the real forecast, three ways: no fire, a fire
 * met with the standard response, and the same fire met by funded crews. The fire is injected as
 * the same persisted occurrence the hazard would create, so disconnected load, constrained
 * generators and restoration cost reach dispatch, sales and cash exactly as in play. It never
 * reveals whether or when a real fire will start: see typicalWildfireIncident.
 */
export function previewWildfire(game: GameType, month: number) {
  const preparedness = wildfirePreparedness(game);
  if (!preparedness) throw new Error("Wildfire preparedness does not apply");
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (!now) throw new Error("No current simulation tick");
  const snapshot = buildStorySnapshot(
    game.monthlyHistory,
    game.facilities,
    game.date.minute,
  );
  const ticks = Math.ceil(
    ((month + 1) * MINUTES_PER_MONTH - game.date.minute) / TICK_MINUTES,
  );
  const inMonth = (timeline: TickPresentFutureType[]) =>
    timeline.filter((t) => Math.floor(t.minute / MINUTES_PER_MONTH) === month);
  const run = (incident?: WildfireIncidentType) => {
    let draft = game;
    if (incident) {
      const occurrence: ActiveWorldEventType = {
        // Forecast effects are cached by occurrence key, so each variant needs its own
        key: `wildfire-preview:${game.location.id}:${month}:${incident.disconnectedDemand}:${incident.outputMultiplier}:${incident.selectedFacilityIds.join(",")}`,
        definitionId: WILDFIRE_DEFINITION_ID,
        startsMinute: month * MINUTES_PER_MONTH,
        endsMinute: (month + 1) * MINUTES_PER_MONTH,
        forecastable: false,
        title: "Wildfire emergency",
        message: "",
        attributes: {},
        effects: wildfireIncidentEffects(incident),
      };
      draft = {
        ...game,
        worldEvents: {
          ...game.worldEvents,
          active: [...game.worldEvents.active, occurrence],
        },
      };
    }
    const timeline = generateNewTimeline(draft, now.cash, now.customers, ticks);
    const selected = inMonth(timeline);
    return {
      demandW: selected.map((t) => t.demandW),
      summary: summarizeTimeline(selected, game.startingYear),
      endingCash: timeline[timeline.length - 1].cash,
    };
  };
  const elapsed = Math.min(
    1,
    Math.max(
      0,
      (month * MINUTES_PER_MONTH - game.date.minute) /
        (WILDFIRE_PREPAREDNESS_RAMP_MONTHS * MINUTES_PER_MONTH),
    ),
  );
  const preparedEffectiveness = preparedness.active
    ? wildfirePreparednessEffectiveness(
        game.worldEvents.occurrences,
        game.location.id,
        month * MINUTES_PER_MONTH,
      )
    : preparedness.effectiveness + (1 - preparedness.effectiveness) * elapsed;
  const standardEffectiveness = preparedness.active
    ? preparedness.effectiveness * (1 - elapsed)
    : wildfirePreparednessEffectiveness(
        game.worldEvents.occurrences,
        game.location.id,
        month * MINUTES_PER_MONTH,
      );
  const standardIncident = typicalWildfireIncident({
    profile: preparedness.profile,
    snapshot,
    effectiveness: standardEffectiveness,
  });
  const preparedIncident = typicalWildfireIncident({
    profile: preparedness.profile,
    snapshot,
    effectiveness: preparedEffectiveness,
  });
  const noFire = run();
  const standard = run(standardIncident);
  const prepared = run(preparedIncident);
  return {
    month,
    standardEffectiveness,
    preparedEffectiveness,
    standardIncident,
    preparedIncident,
    noFire: noFire.summary,
    standard: standard.summary,
    prepared: prepared.summary,
    standardDemandW: standard.demandW,
    preparedDemandW: prepared.demandW,
    // What funded crews are worth in this fire, before their own price: more sales and less
    // shortfall. Restoration costs the same either way, so it cancels out.
    cashBenefit: prepared.endingCash - standard.endingCash,
  };
}
export type WildfirePreviewResult = ReturnType<typeof previewWildfire>;
