import {
  ActiveWorldEventType,
  GameType,
  MonthlyHistoryType,
  ScenarioChoiceType,
  StorySnapshotType,
  WildfireProfileType,
} from "../Types";
import { getWildfireProfile } from "../data/WildfireProfiles";
import smokeHistory from "../data/WildfireSmokeHistory.json";
import { storyHash } from "../data/WorldEvents";
import { CUSTOM_SCENARIO_ID, getScenario } from "../data/Scenarios";
import { CALIFORNIA_WILDFIRE_READINESS_COST } from "../data/CaliforniaWildfire";
import { SCENARIO_PREPARATION_MONTHS } from "../data/ScenarioPreparation";
import { randomAt, RANDOM_STREAM } from "./Math";
import { MINUTES_PER_MONTH } from "./DateTime";

/**
 * A deterministic bootstrap of complete observed smoke-detection years.
 * The NOAA record supplies seasonality, quiet years, and clustering. A NREL
 * reference supplies a documented heavy-smoke stress attenuation. HMS density
 * is not an irradiance coefficient; this transfer is a coarse model assumption.
 */
export const WILDFIRE_DEFINITION_ID = "wildfire-smoke";
export const WILDFIRE_AUTHORED_SCENARIO_ID = 111;
export const WILDFIRE_OPT_IN_SCENARIOS: ReadonlySet<number> = new Set();

// The representative day stands for a uniform 365/12-day month. Smoke affects
// only the reference's daytime sampling window; no outage chronology is inferred.
export const WILDFIRE_REPRESENTED_DAYS_PER_MONTH = 365 / 12;

export function wildfireOccurrenceKey(
  locationId: string,
  monthsElapsed: number,
): string {
  return `wildfire:${locationId}:${monthsElapsed}`;
}

export function wildfirePreparednessKey(
  locationId: string,
  change: number,
): string {
  return `wildfire:${locationId}:preparedness:${change}`;
}

/** Preserve the registered stream; addressed draws never depend on evaluation order. */
export function wildfireDraw(
  seed: number,
  locationId: string,
  period: number,
  attribute: string,
): number {
  return randomAt(
    seed,
    RANDOM_STREAM.wildfireHazards,
    storyHash(`wildfire|${locationId}|${period}|${attribute}`),
  );
}

export function wildfireProfileForGame(
  game: GameType,
): WildfireProfileType | undefined {
  return getWildfireProfile(game.location?.id);
}

/** Scored missions retain their authored events until they explicitly opt in. */
export function isWildfireHazardEligible(game: GameType): boolean {
  return (
    !game.storyEffectsDisabled &&
    !game.wildfireHazardDisabled &&
    !!wildfireProfileForGame(game) &&
    game.scenarioId !== WILDFIRE_AUTHORED_SCENARIO_ID &&
    (game.scenarioId === CUSTOM_SCENARIO_ID ||
      WILDFIRE_OPT_IN_SCENARIOS.has(game.scenarioId))
  );
}

export function activeWildfire(
  active: ActiveWorldEventType[],
  locationId: string,
): ActiveWorldEventType | undefined {
  return active.find(
    (event) =>
      event.definitionId === WILDFIRE_DEFINITION_ID &&
      event.key.startsWith(`wildfire:${locationId}:`),
  );
}

/** One historical year is selected for all twelve months of a run's calendar year. */
export function sampleWildfireSourceYear(args: {
  profile: WildfireProfileType;
  seed: number;
  locationId: string;
  monthsElapsed: number;
  startingYear?: number;
}): number {
  const { profile, seed, locationId, monthsElapsed, startingYear = 0 } = args;
  const calendarYear = startingYear + Math.floor(monthsElapsed / 12);
  const index = Math.floor(
    wildfireDraw(seed, locationId, calendarYear, "source-year") *
      profile.sourceYears.length,
  );
  return profile.sourceYears[index];
}

/** Count heavy detections only; unknown and lighter classes do not imply clear air. */
export function wildfireHeavySmokeDays(
  profile: WildfireProfileType,
  sourceYear: number,
  monthIndex: number,
): number {
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw new RangeError("Smoke month must be an integer index from 0 to 11");
  }
  const source = smokeHistory.years.find((year) => year.year === sourceYear);
  if (!source || !profile.sourceYears.includes(sourceYear)) {
    throw new RangeError(
      "Smoke source year must belong to the reviewed catalogue",
    );
  }
  const firstDay =
    (Date.UTC(sourceYear, monthIndex, 1) - Date.UTC(sourceYear, 0, 1)) /
    86400000;
  const nextMonth =
    (Date.UTC(sourceYear, monthIndex + 1, 1) - Date.UTC(sourceYear, 0, 1)) /
    86400000;
  return [
    ...source.locations[profile.locationId].dailyDensity.slice(
      firstDay,
      nextMonth,
    ),
  ].filter((density) => density === "3").length;
}

/** Equal-day mean of the five rounded regional GHI losses in NREL Figure 18. */
export function wildfireReferenceAttenuation(
  profile: WildfireProfileType,
): number {
  return (
    profile.dailyReferenceAttenuation.reduce((sum, loss) => sum + loss, 0) /
    profile.dailyReferenceAttenuation.length
  );
}

/** Latest accepted program change at this instant. Array order breaks same-minute ties. */
export function wildfirePreparednessChange(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  minute: number,
): ActiveWorldEventType | undefined {
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const event = occurrences[i];
    if (
      event.key.startsWith(`wildfire:${locationId}:preparedness:`) &&
      event.startsMinute <= minute
    )
      return event;
  }
  return undefined;
}

/** Whether finite backup is currently reserved for the imported scenario. */
export function activePreparedness(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  monthsElapsed: number,
): boolean {
  return (
    wildfirePreparednessChange(
      occurrences,
      locationId,
      monthsElapsed * MINUTES_PER_MONTH,
    )?.attributes.choice === "prepare"
  );
}

/** Reserving or releasing the mobile unit takes effect immediately. */
export function wildfirePreparednessEffectiveness(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  minute: number,
): number {
  const change = wildfirePreparednessChange(occurrences, locationId, minute);
  return change?.attributes.choice === "prepare" ? 1 : 0;
}

/** Annual operating budget, accrued by the same tick accounting as other operating costs. */
export function wildfirePreparednessAnnualCost(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  minute: number,
): number {
  const reservationEndsMonth =
    13 + SCENARIO_PREPARATION_MONTHS[WILDFIRE_AUTHORED_SCENARIO_ID];
  if (minute >= reservationEndsMonth * MINUTES_PER_MONTH) return 0;
  const change = wildfirePreparednessChange(occurrences, locationId, minute);
  return change?.attributes.choice === "prepare"
    ? CALIFORNIA_WILDFIRE_READINESS_COST
    : 0;
}

/** One month's persisted heavy-smoke parameters; no plant damage is inferred. */
export interface WildfireIncidentType {
  sourceYear: number;
  heavySmokeDays: number;
  referenceAttenuation: number;
  solarIrradianceMultiplier: number;
  durationMonths: 1;
}

/** Snapshot and preparedness are accepted for existing callers; neither changes airborne smoke. */
export function sampleWildfireIncident(args: {
  profile: WildfireProfileType;
  seed: number;
  locationId: string;
  monthsElapsed: number;
  startingYear?: number;
  snapshot?: StorySnapshotType;
  effectiveness?: number;
}): WildfireIncidentType | undefined {
  const sourceYear = sampleWildfireSourceYear(args);
  const heavySmokeDays = wildfireHeavySmokeDays(
    args.profile,
    sourceYear,
    ((args.monthsElapsed % 12) + 12) % 12,
  );
  if (!heavySmokeDays) return undefined;
  const referenceAttenuation = wildfireReferenceAttenuation(args.profile);
  return {
    sourceYear,
    heavySmokeDays,
    referenceAttenuation,
    solarIrradianceMultiplier:
      1 -
      referenceAttenuation *
        Math.min(1, heavySmokeDays / WILDFIRE_REPRESENTED_DAYS_PER_MONTH),
    durationMonths: 1,
  };
}

/** Only incoming solar irradiance in the source's 10am-6pm window is attenuated. */
export function wildfireIncidentEffects(
  incident: WildfireIncidentType,
  profile: WildfireProfileType,
): ActiveWorldEventType["effects"] {
  return {
    solarIrradianceMultipliersByHour: Object.fromEntries(
      Array.from(
        { length: profile.localEndHour - profile.localStartHour },
        (_, offset) => [
          String(profile.localStartHour + offset),
          incident.solarIrradianceMultiplier,
        ],
      ),
    ),
  };
}

export interface WildfireImpactSummaryType {
  incidentCount: number;
  totalHeavySmokeDays: number;
  /** Legacy balance-report columns: smoke does not disconnect customers or require repairs. */
  totalDisconnectedWh: number;
  averageSeverity: number | null;
  totalRestorationCost: number;
}

export function summarizeWildfireImpact(
  _monthlyHistory: MonthlyHistoryType[],
  occurrences: ActiveWorldEventType[],
  _startingYear: number,
): WildfireImpactSummaryType {
  const incidents = occurrences.filter(
    (event) => event.definitionId === WILDFIRE_DEFINITION_ID,
  );
  return {
    incidentCount: incidents.length,
    totalHeavySmokeDays: incidents.reduce(
      (sum, event) => sum + Number(event.attributes.heavySmokeDays || 0),
      0,
    ),
    totalDisconnectedWh: 0,
    averageSeverity: null,
    totalRestorationCost: 0,
  };
}

export interface WildfireRiskNoticeType {
  title: string;
  message: string;
}

/** Historical seasonality notice; it does not disclose the run's sampled source year. */
export function wildfireRiskNotice(
  game: GameType,
): WildfireRiskNoticeType | undefined {
  if (!isWildfireHazardEligible(game)) return undefined;
  const profile = wildfireProfileForGame(game);
  if (
    !profile ||
    !profile.sourceYears.some(
      (year) =>
        wildfireHeavySmokeDays(profile, year, game.date.monthNumber - 1) > 0,
    )
  )
    return undefined;
  return {
    title: "Wildfire smoke season",
    message:
      "Heavy wildfire smoke can reduce sunlight for solar generation this month.",
  };
}

/** Standing reservation for the single imported historical fire-response episode. */
export interface WildfirePreparednessType {
  fireMonth: number;
  active: boolean;
  effectiveness: number;
  tooLate: boolean;
  annualCost: number;
  choice: ScenarioChoiceType;
}

/** Reserve finite local backup. Smoke exposure alone does not justify a generic protection program. */
export function wildfirePreparedness(
  game: GameType,
): WildfirePreparednessType | undefined {
  const importedWildfire =
    game.scenarioId === CUSTOM_SCENARIO_ID &&
    game.customScenario?.eventScenarioIds?.includes(
      WILDFIRE_AUTHORED_SCENARIO_ID,
    ) &&
    !game.storyEffectsDisabled;
  if (!importedWildfire) return undefined;
  const fireMonth =
    12 + SCENARIO_PREPARATION_MONTHS[WILDFIRE_AUTHORED_SCENARIO_ID];
  if (game.date.monthsElapsed >= fireMonth + 1) return undefined;
  const changes = game.worldEvents.occurrences.filter((event) =>
    event.key.startsWith(`wildfire:${game.location.id}:preparedness:`),
  );
  const nextChange = changes.reduce(
    (next, event) => Math.max(next, Number(event.key.split(":").pop()) + 1),
    0,
  );
  const key = wildfirePreparednessKey(game.location.id, nextChange);
  const current = wildfirePreparednessChange(
    changes,
    game.location.id,
    game.date.minute,
  );
  const active = current?.attributes.choice === "prepare";
  if (!active && game.date.monthsElapsed >= fireMonth) return undefined;
  const runEnd =
    getScenario(game.scenarioId, game.customScenario)?.durationMonths ??
    Infinity;
  const annualCost = CALIFORNIA_WILDFIRE_READINESS_COST;
  return {
    fireMonth,
    active,
    annualCost,
    effectiveness: wildfirePreparednessEffectiveness(
      changes,
      game.location.id,
      game.date.minute,
    ),
    tooLate: fireMonth >= runEnd || game.date.monthsElapsed >= fireMonth,
    choice: {
      id: key,
      scenarioId: game.scenarioId,
      atMonth: game.date.monthsElapsed,
      title: "Wildfire preparedness",
      message:
        "Reserve one mobile generator for eligible local critical sites during the selected wildfire scenario.",
      options: [
        {
          id: active ? "stop" : "prepare",
          label: active ? "Turn off preparedness" : "Start preparedness",
          cost: () => 0,
          description: active
            ? "Release the reservation and stop future spending. Already recorded incident support is unchanged."
            : "Annualized reservation budget, billed monthly through the incident month. Available immediately; up to 150 kW for 24 hours (3.6 MWh).",
          message: active
            ? "Local backup reservation released. Future spending stops."
            : "Local backup reserved: up to 150 kW for 24 hours (3.6 MWh). Monthly reservation charges end after the incident month.",
        },
      ],
    },
  };
}
