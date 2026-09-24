import {
  ActiveWorldEventType,
  DateType,
  DifficultyType,
  GameType,
  MonthlyHistoryType,
  ScenarioChoiceType,
  StorySnapshotType,
  WildfireProfileType,
} from "../Types";
import { getWildfireProfile } from "../data/WildfireProfiles";
import { storyHash } from "../data/WorldEvents";
import {
  getMonthlyClimatology,
  getWeather,
  MonthlyClimatologyType,
} from "../data/Weather";
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { DIFFICULTIES } from "../Constants";
import { randomAt, RANDOM_STREAM } from "./Math";
import { MINUTES_PER_MONTH } from "./DateTime";
import { buildStorySnapshot } from "./Story";

/**
 * Recurring, location-aware wildfire hazards.
 *
 * This is the deterministic engine behind issue #62's "seasonal regional probability with bounded
 * weather modifiers." Every draw is addressed by (seed, dedicated hazard stream, location, absolute
 * month, attribute) rather than pulled from a running generator, so the whole hazard is a pure
 * function of its inputs: saving, forecasting, or reordering evaluation can never reroll it. The
 * occurrence, severity, duration and facility-selection draws are separate addressed values so one
 * cannot leak into another.
 *
 * The values are explicitly simplified game balance, not observed fire statistics, and the model
 * makes no claim that sampled city precipitation measures drought or that plant exposure is
 * geographically accurate. See src/data/WildfireProfiles.tsx and issue #62.
 */

/** Stable definition id for a recurring wildfire occurrence (distinct from authored story keys). */
export const WILDFIRE_DEFINITION_ID = "recurring-wildfire";

/** The authored scenario whose fixed January 2025 firestorm must not be overlapped by a random one. */
export const WILDFIRE_AUTHORED_SCENARIO_ID = 111;

/** Scored scenarios that explicitly opt in to the recurring hazard (none yet, by design). */
export const WILDFIRE_OPT_IN_SCENARIOS: ReadonlySet<number> = new Set();

/** Share of incidents that get a two-month restoration tail rather than the usual one month. */
export const WILDFIRE_TWO_MONTH_TAIL_PROBABILITY = 0.15;

/** Restoration cost scales with this severity factor, in [0.5, 1.5], on top of system size. */
function restorationSeverityFactor(severity: number): number {
  return 0.5 + severity;
}

/** Preparedness halves disconnections and output losses, mirroring the authored scenario 111. */
export const WILDFIRE_PREPAREDNESS_DISCONNECTION_FACTOR = 0.5;

/** Season-scoped preparedness price, per MWh of exposed monthly demand, before difficulty scaling. */
export const WILDFIRE_PREPAREDNESS_COST_PER_MWH = 3;

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * Math.min(1, Math.max(0, t));
}

/** The occurrence key for a hazard check in an absolute month; doubles as the dedupe check key. */
export function wildfireOccurrenceKey(
  locationId: string,
  monthsElapsed: number,
): string {
  return `wildfire:${locationId}:${monthsElapsed}`;
}

/** The season-scoped preparedness decision key, stable per location and calendar year. */
export function wildfirePreparednessKey(
  locationId: string,
  year: number,
): string {
  return `wildfire:${locationId}:${year}:preparedness`;
}

/** One addressed draw in [0, 1) for a hazard attribute; pure and order-independent. */
export function wildfireDraw(
  seed: number,
  locationId: string,
  monthsElapsed: number,
  attribute: string,
): number {
  return randomAt(
    seed,
    RANDOM_STREAM.wildfireHazards,
    storyHash(`wildfire|${locationId}|${monthsElapsed}|${attribute}`),
  );
}

/**
 * The monthly ignition probability, `1 - exp(-annualHazard * monthlyWeight * weatherModifier)`,
 * with weights summing to one over the year. A zero-weight month is a guaranteed no-fire, and the
 * result is always in [0, 1) so a fire-risk season never means a guaranteed destructive fire.
 */
export function wildfireMonthlyProbability(
  profile: WildfireProfileType,
  monthIndex: number,
  weatherModifier = 1,
): number {
  const weight = profile.monthlyWeights[monthIndex] ?? 0;
  if (weight <= 0 || profile.annualHazard <= 0) {
    return 0;
  }
  const lambda = profile.annualHazard * weight * weatherModifier;
  if (lambda <= 0) {
    return 0;
  }
  return Math.min(1, 1 - Math.exp(-lambda));
}

/** A representative day's average temperature and wind, the basis for a bounded anomaly. */
export interface FireWeatherReading {
  tempC: number;
  windKph: number;
}

/**
 * The representative day's average temperature and wind for a date. Pure in (date, seed); returns
 * the loaded series' values or the weather module's dummy when nothing is loaded.
 */
export function dailyFireWeatherReading(
  date: DateType,
  seed: number,
): FireWeatherReading {
  let tempSum = 0;
  let windSum = 0;
  for (let hour = 0; hour < 24; hour++) {
    const reading = getWeather(
      { ...date, hourOfDay: hour, minuteOfDay: hour * 60 },
      seed,
    );
    tempSum += reading.TEMP_C;
    windSum += reading.WIND_KPH;
  }
  return { tempC: tempSum / 24, windKph: windSum / 24 };
}

/**
 * A bounded fire-weather modifier in [0.5, 2] from the day's temperature and wind anomalies
 * relative to the location's observed monthly normals. Hot and windy raises risk; cool or calm
 * lowers it. With no reading or no normals there is no signal, so the modifier stays neutral at 1
 * rather than inventing one. This is a modest game proxy, not a fire-weather index.
 */
export function weatherFireRiskModifier(
  reading: FireWeatherReading | undefined,
  climatology: MonthlyClimatologyType | undefined,
): number {
  if (!reading || !climatology) {
    return 1;
  }
  const tempAnomaly =
    (reading.tempC - climatology.tempMean) / Math.max(climatology.tempSd, 0.5);
  const windAnomaly =
    (reading.windKph - climatology.windMean) / Math.max(climatology.windSd, 2);
  const raw = 1 + 0.25 * tempAnomaly + 0.25 * windAnomaly;
  return Math.min(2, Math.max(0.5, raw));
}

/** The authored hazard for a game's location, or undefined when the area carries no profile. */
export function wildfireProfileForGame(
  game: GameType,
): WildfireProfileType | undefined {
  return getWildfireProfile(game.location?.id);
}

/**
 * Whether the recurring hazard may fire in this game. Custom games in a profiled area are eligible;
 * the authored scenario 111 keeps its fixed story (random overlap is suppressed there); and no other
 * scored scenario opts in until explicitly balanced. Unknown locations carry no profile, hence no risk.
 */
export function isWildfireHazardEligible(game: GameType): boolean {
  if (game.storyEffectsDisabled || game.wildfireHazardDisabled) {
    return false;
  }
  if (!wildfireProfileForGame(game)) {
    return false;
  }
  if (game.scenarioId === WILDFIRE_AUTHORED_SCENARIO_ID) {
    return false;
  }
  if (
    game.scenarioId !== CUSTOM_SCENARIO_ID &&
    !WILDFIRE_OPT_IN_SCENARIOS.has(game.scenarioId)
  ) {
    return false;
  }
  return true;
}

/** The most recent month a wildfire started at this location, from persisted occurrences. */
export function lastWildfireOnsetMonth(
  occurrences: ActiveWorldEventType[],
  locationId: string,
): number | undefined {
  let latest: number | undefined;
  occurrences.forEach((event) => {
    if (event.definitionId !== WILDFIRE_DEFINITION_ID) {
      return;
    }
    if (!event.key.startsWith(`wildfire:${locationId}:`)) {
      return;
    }
    const onsetMonth = Math.floor(event.startsMinute / MINUTES_PER_MONTH);
    if (latest === undefined || onsetMonth > latest) {
      latest = onsetMonth;
    }
  });
  return latest;
}

/** Whether the location is still in its post-incident cooldown. */
export function wildfireInCooldown(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  monthsElapsed: number,
  profile: WildfireProfileType,
): boolean {
  const last = lastWildfireOnsetMonth(occurrences, locationId);
  if (last === undefined) {
    return false;
  }
  return monthsElapsed < last + profile.cooldownMonths;
}

/** The region's currently active wildfire, if any (one per region). */
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

/**
 * Whether a funded preparedness is still in force for this location at an absolute month: answered
 * within the last `preparednessDurationMonths` and chosen as "prepare".
 */
export function activePreparedness(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  monthsElapsed: number,
): boolean {
  const profile = getWildfireProfile(locationId);
  if (!profile) {
    return false;
  }
  return occurrences.some((event) => {
    if (event.attributes.choice !== "prepare") {
      return false;
    }
    if (!event.key.startsWith(`wildfire:${locationId}:`)) {
      return false;
    }
    const answerMonth = Math.floor(event.startsMinute / MINUTES_PER_MONTH);
    return (
      monthsElapsed >= answerMonth &&
      monthsElapsed < answerMonth + profile.preparednessDurationMonths
    );
  });
}

/** Restoration cost per active month, scaled to exposed system size and incident severity. */
export function restorationCostPerMonth(
  profile: WildfireProfileType,
  exposedDemandMWh: number,
  severity: number,
): number {
  return (
    profile.restorationCostPerMWh *
    Math.max(0, exposedDemandMWh) *
    restorationSeverityFactor(severity)
  );
}

/** Aggregate impact of the recurring hazard over a run, for balance comparison across seeds. */
export interface WildfireImpactSummaryType {
  incidentCount: number;
  /** Energy cut off by safety shutoffs, recovered from the connected (reduced) demand. */
  totalDisconnectedWh: number;
  /** Mean severity draw across incidents, or null when none occurred. */
  averageSeverity: number | null;
  /** Restoration cost booked across all active incident months. */
  totalRestorationCost: number;
}

/**
 * Sums the hazard's impact over a run's monthly history. The history's demandWh is the connected
 * (post-shutoff) demand, so the disconnected share is recovered as `demandWh * d / (1 - d)` for
 * each month an incident was active. Pure in its inputs; the history may be in either order.
 */
export function summarizeWildfireImpact(
  monthlyHistory: MonthlyHistoryType[],
  occurrences: ActiveWorldEventType[],
  startingYear: number,
): WildfireImpactSummaryType {
  const incidents = occurrences.filter(
    (event) => event.definitionId === WILDFIRE_DEFINITION_ID,
  );
  let totalDisconnectedWh = 0;
  let totalRestorationCost = 0;
  monthlyHistory.forEach((month) => {
    const monthsElapsed = (month.year - startingYear) * 12 + (month.month - 1);
    const minute = monthsElapsed * MINUTES_PER_MONTH;
    incidents.forEach((incident) => {
      if (minute < incident.startsMinute || minute >= incident.endsMinute) {
        return;
      }
      const disconnected =
        (incident.attributes.disconnectedDemand as number) || 0;
      if (disconnected > 0 && disconnected < 1) {
        totalDisconnectedWh +=
          (month.demandWh * disconnected) / (1 - disconnected);
      }
      totalRestorationCost +=
        (incident.attributes.restorationCostPerMonth as number) || 0;
    });
  });
  const severities = incidents.map(
    (incident) => (incident.attributes.severity as number) || 0,
  );
  return {
    incidentCount: incidents.length,
    totalDisconnectedWh,
    averageSeverity: severities.length
      ? severities.reduce((total, value) => total + value, 0) /
        severities.length
      : null,
    totalRestorationCost,
  };
}

/** A fully sampled incident: severity, duration, affected facilities and restoration cost. */
export interface WildfireIncidentType {
  severity: number; // [0, 1]
  disconnectedDemand: number; // share of customer load cut (after preparedness)
  outputMultiplier: number; // output retained by affected generators (after preparedness)
  targetCapacityShare: number; // share of fleet peak capacity constrained
  durationMonths: number; // 1, or 2 for the rare restoration tail
  selectedFacilityIds: number[];
  selectedFacilityNames: string[];
  restorationCostPerMonth: number;
}

/**
 * Selects the affected operational generators, reusing the authored story's approach: score each
 * candidate with its own addressed draw, take them cheapest-score-first until the target share of
 * fleet peak capacity is reached. Deterministic and independent of fleet array order.
 */
function selectAffectedFacilities(
  snapshot: StorySnapshotType,
  targetCapacityShare: number,
  seed: number,
  locationId: string,
  monthsElapsed: number,
): { selectedFacilityIds: number[]; selectedFacilityNames: string[] } {
  const candidates = snapshot.facilities
    .filter((facility) => facility.operational && !!facility.fuel)
    .map((facility) => ({
      ...facility,
      score: wildfireDraw(
        seed,
        locationId,
        monthsElapsed,
        `facility|${facility.id}`,
      ),
    }))
    .sort((a, b) => a.score - b.score || a.id - b.id);
  const totalPeakW = candidates.reduce(
    (total, facility) => total + facility.peakW,
    0,
  );
  const targetPeakW = totalPeakW * targetCapacityShare;
  const selected: typeof candidates = [];
  let selectedPeakW = 0;
  for (const candidate of candidates) {
    if (selectedPeakW >= targetPeakW) {
      break;
    }
    selected.push(candidate);
    selectedPeakW += candidate.peakW;
  }
  return {
    selectedFacilityIds: selected.map((facility) => facility.id),
    selectedFacilityNames: selected.map((facility) => facility.name),
  };
}

/**
 * Samples one incident's onset attributes from separate addressed draws. Pure: the same inputs
 * always yield the same incident, which is what makes saves, forecasts and replays agree.
 */
export function sampleWildfireIncident(args: {
  profile: WildfireProfileType;
  seed: number;
  locationId: string;
  monthsElapsed: number;
  snapshot: StorySnapshotType;
  prepared: boolean;
}): WildfireIncidentType {
  const { profile, seed, locationId, monthsElapsed, snapshot, prepared } = args;
  const severity = wildfireDraw(seed, locationId, monthsElapsed, "severity");
  const durationMonths =
    wildfireDraw(seed, locationId, monthsElapsed, "duration") <
    WILDFIRE_TWO_MONTH_TAIL_PROBABILITY
      ? 2
      : 1;

  const rawDisconnectedDemand = lerp(
    profile.disconnectedDemand.min,
    profile.disconnectedDemand.max,
    severity,
  );
  const rawOutputMultiplier = lerp(
    profile.outputMultiplier.min,
    profile.outputMultiplier.max,
    severity,
  );
  const targetCapacityShare = lerp(
    profile.targetCapacityShare.min,
    profile.targetCapacityShare.max,
    severity,
  );

  // Preparedness halves disconnections and output losses; it does not prevent the fire or reduce
  // restoration costs.
  const disconnectedDemand = prepared
    ? rawDisconnectedDemand * WILDFIRE_PREPAREDNESS_DISCONNECTION_FACTOR
    : rawDisconnectedDemand;
  const outputMultiplier = prepared
    ? (1 + rawOutputMultiplier) / 2
    : rawOutputMultiplier;

  const { selectedFacilityIds, selectedFacilityNames } =
    selectAffectedFacilities(
      snapshot,
      targetCapacityShare,
      seed,
      locationId,
      monthsElapsed,
    );

  const exposedDemandMWh = snapshot.demandWh12m / 12 / 1e6;
  const restorationCost = restorationCostPerMonth(
    profile,
    exposedDemandMWh,
    severity,
  );

  return {
    severity,
    disconnectedDemand,
    outputMultiplier,
    targetCapacityShare,
    durationMonths,
    selectedFacilityIds,
    selectedFacilityNames,
    restorationCostPerMonth: restorationCost,
  };
}

/** A non-blocking seasonal risk notice for the Events pane; never reveals a seeded ignition date. */
export interface WildfireRiskNoticeType {
  title: string;
  message: string;
}

/**
 * The seasonal fire-risk notice for an eligible game, shown only in above-average-risk months.
 * It explains the risk (season plus this month's weather) without revealing when -- or whether --
 * a fire will start. Pure in its inputs; callers should cache it, since the weather reading is
 * not free.
 */
export function wildfireRiskNotice(
  game: GameType,
): WildfireRiskNoticeType | undefined {
  if (!isWildfireHazardEligible(game)) {
    return undefined;
  }
  const profile = getWildfireProfile(game.location.id);
  if (!profile) {
    return undefined;
  }
  const monthIndex = game.date.monthNumber - 1;
  const weight = profile.monthlyWeights[monthIndex] ?? 0;
  if (weight <= 1 / 12) {
    return undefined; // Only above-average-risk months warrant a notice.
  }
  const modifier = weatherFireRiskModifier(
    dailyFireWeatherReading(game.date, game.seed),
    getMonthlyClimatology(monthIndex),
  );
  let weatherReason: string;
  if (modifier > 1.05) {
    weatherReason = "Hotter, windier-than-normal conditions";
  } else if (modifier < 0.95) {
    weatherReason = "Cooler, calmer-than-normal conditions";
  } else {
    weatherReason = "Near-normal conditions";
  }
  return {
    title: "Elevated wildfire risk",
    message: `${weatherReason} in ${game.location.name} raise the chance of a wildfire emergency this season, which could disconnect customers and constrain generation.`,
  };
}

/**
 * The season-scoped preparedness decision for an eligible game, offered in the profile's
 * preparedness month and answered at most once per calendar year. The price scales to the exposed
 * system's monthly demand and the difficulty, so it is a meaningful tradeoff rather than a fixed
 * municipal figure. Returns undefined when there is nothing to offer this month.
 */
export function wildfirePreparednessChoice(
  game: GameType,
): ScenarioChoiceType | undefined {
  if (!isWildfireHazardEligible(game)) {
    return undefined;
  }
  const profile = getWildfireProfile(game.location.id);
  if (!profile) {
    return undefined;
  }
  const monthIndex = game.date.monthNumber - 1;
  if (monthIndex !== profile.preparednessMonth) {
    return undefined;
  }
  const key = wildfirePreparednessKey(game.location.id, game.date.year);
  if (game.worldEvents.occurrences.some((event) => event.key === key)) {
    return undefined; // Already answered this season.
  }
  const snapshot = buildStorySnapshot(
    game.monthlyHistory,
    game.facilities,
    game.date.minute,
  );
  const exposedDemandMWh = snapshot.demandWh12m / 12 / 1e6;
  const cost = (difficulty: DifficultyType): number =>
    Math.round(
      WILDFIRE_PREPAREDNESS_COST_PER_MWH *
        exposedDemandMWh *
        DIFFICULTIES[difficulty].buildCost,
    );
  return {
    id: key,
    scenarioId: game.scenarioId,
    atMonth: game.date.monthsElapsed,
    title: "Wildfire season preparedness",
    message: `Prepare for elevated fire risk in ${game.location.name} or save cash; restoration costs apply either way.`,
    options: [
      {
        id: "prepare",
        label: "Fund preparedness",
        cost,
        description: `Spend {cost} to halve customer disconnections and generator output losses if a wildfire starts within ${profile.preparednessDurationMonths} months.`,
        message: "Preparedness funded for the season.",
      },
      {
        id: "standard",
        meaningful: false,
        label: "Keep cash",
        cost: () => 0,
        description:
          "Save cash and accept full customer disconnections and generator output losses if a wildfire strikes this season.",
        message:
          "Cash is preserved, with the full impact of any wildfire that starts this season.",
      },
    ],
  };
}
