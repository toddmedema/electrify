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
import { CUSTOM_SCENARIO_ID, getScenario } from "../data/Scenarios";
import { DIFFICULTIES } from "../Constants";
import { randomAt, RANDOM_STREAM } from "./Math";
import {
  MINUTES_PER_MONTH,
  summarizeHistory,
  summarizeTimeline,
} from "./DateTime";

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

/** One fire season's preparedness coverage, in absolute months (end exclusive). */
export interface WildfireSeasonType {
  /** Calendar year the season starts in; it names the season's preparedness key. */
  year: number;
  startMonth: number;
  endMonth: number;
}

/** The absolute month a calendar year's fire season starts. */
function wildfireSeasonStart(
  profile: WildfireProfileType,
  startingYear: number,
  year: number,
): number {
  return (year - startingYear) * 12 + profile.preparednessMonth;
}

/**
 * The fire season preparedness would cover from an absolute month: the one underway, or else the
 * next one to start. Seasons run `preparednessDurationMonths` from the profile's preparedness month.
 */
export function wildfireSeasonAt(
  profile: WildfireProfileType,
  startingYear: number,
  monthsElapsed: number,
): WildfireSeasonType {
  const year = startingYear + Math.floor(monthsElapsed / 12);
  for (const candidate of [year - 1, year]) {
    const startMonth = wildfireSeasonStart(profile, startingYear, candidate);
    const endMonth = startMonth + profile.preparednessDurationMonths;
    if (monthsElapsed < endMonth) {
      return { year: candidate, startMonth, endMonth };
    }
  }
  const startMonth = wildfireSeasonStart(profile, startingYear, year + 1);
  return {
    year: year + 1,
    startMonth,
    endMonth: startMonth + profile.preparednessDurationMonths,
  };
}

/**
 * Whether funded preparedness covers this location at an absolute month: the player funded the
 * season whose window contains the month. Funding is season-scoped, so paying ahead of the season
 * covers all of it and paying partway through covers what is left.
 */
export function activePreparedness(
  occurrences: ActiveWorldEventType[],
  locationId: string,
  monthsElapsed: number,
  startingYear: number,
): boolean {
  const profile = getWildfireProfile(locationId);
  if (!profile) {
    return false;
  }
  return occurrences.some((event) => {
    if (event.attributes.choice !== "prepare") {
      return false;
    }
    const match = /^wildfire:(.+):(\d+):preparedness$/.exec(event.key);
    if (!match || match[1] !== locationId) {
      return false;
    }
    const startMonth = wildfireSeasonStart(
      profile,
      startingYear,
      Number(match[2]),
    );
    return (
      monthsElapsed >= startMonth &&
      monthsElapsed < startMonth + profile.preparednessDurationMonths
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
 * Selects the affected operational generators, reusing the authored story's approach: rank each
 * candidate by its score, lowest first, and take them until the target share of fleet peak
 * capacity is reached. Deterministic and independent of fleet array order.
 */
function selectAffectedFacilities(
  snapshot: StorySnapshotType,
  targetCapacityShare: number,
  score: (facility: StorySnapshotType["facilities"][number]) => number,
): { selectedFacilityIds: number[]; selectedFacilityNames: string[] } {
  const candidates = snapshot.facilities
    .filter((facility) => facility.operational && !!facility.fuel)
    .map((facility) => ({ ...facility, score: score(facility) }))
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

/** An incident's physical effects at a severity, with preparedness applied. */
function wildfireIncidentAt(args: {
  profile: WildfireProfileType;
  severity: number;
  durationMonths: number;
  snapshot: StorySnapshotType;
  prepared: boolean;
  selectFacilities: (targetCapacityShare: number) => {
    selectedFacilityIds: number[];
    selectedFacilityNames: string[];
  };
}): WildfireIncidentType {
  const { profile, severity, durationMonths, snapshot, prepared } = args;
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

  const exposedDemandMWh = snapshot.demandWh12m / 12 / 1e6;
  return {
    severity,
    disconnectedDemand,
    outputMultiplier,
    targetCapacityShare,
    durationMonths,
    ...args.selectFacilities(targetCapacityShare),
    restorationCostPerMonth: restorationCostPerMonth(
      profile,
      exposedDemandMWh,
      severity,
    ),
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
  return wildfireIncidentAt({
    profile,
    severity: wildfireDraw(seed, locationId, monthsElapsed, "severity"),
    durationMonths:
      wildfireDraw(seed, locationId, monthsElapsed, "duration") <
      WILDFIRE_TWO_MONTH_TAIL_PROBABILITY
        ? 2
        : 1,
    snapshot,
    prepared,
    // Each candidate gets its own addressed draw.
    selectFacilities: (share) =>
      selectAffectedFacilities(snapshot, share, (facility) =>
        wildfireDraw(
          seed,
          locationId,
          monthsElapsed,
          `facility|${facility.id}`,
        ),
      ),
  });
}

/** The severity a preview illustrates: the middle of the profile's sampled range. */
export const WILDFIRE_TYPICAL_SEVERITY = 0.5;

/**
 * A representative one-month incident for previews. It uses the typical severity and constrains
 * the largest generators first rather than the seeded draws, so a preview never reveals when a
 * fire will start, how severe it will be, or which plants it will reach.
 */
export function typicalWildfireIncident(args: {
  profile: WildfireProfileType;
  snapshot: StorySnapshotType;
  prepared: boolean;
}): WildfireIncidentType {
  const { profile, snapshot, prepared } = args;
  return wildfireIncidentAt({
    profile,
    severity: WILDFIRE_TYPICAL_SEVERITY,
    durationMonths: 1,
    snapshot,
    prepared,
    selectFacilities: (share) =>
      selectAffectedFacilities(snapshot, share, (facility) => -facility.peakW),
  });
}

/** The persisted effects a wildfire incident applies while it is active. */
export function wildfireIncidentEffects(
  incident: WildfireIncidentType,
): ActiveWorldEventType["effects"] {
  return {
    demandMultiplier: 1 - incident.disconnectedDemand,
    facilityOutputMultipliersById: Object.fromEntries(
      incident.selectedFacilityIds.map((id) => [
        String(id),
        incident.outputMultiplier,
      ]),
    ),
    operatingExpensePerMonth: incident.restorationCostPerMonth,
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

/** Where the player stands on the upcoming or current fire season's preparedness. */
export interface WildfirePreparednessType {
  profile: WildfireProfileType;
  season: WildfireSeasonType;
  /** First month a hazard check could still meet funded crews: the season's start or next month. */
  firstCoveredMonth: number;
  funded: boolean;
  /** Funding would cover no month of this run. */
  tooLate: boolean;
  /** The one-time price at the game's difficulty. */
  cost: number;
  /** The replayable choice that funds it; undefined once funded or too late. */
  choice?: ScenarioChoiceType;
}

/**
 * Season-scoped wildfire preparedness for an eligible game. It is an optional program rather than
 * a decision the clock waits on: the player can fund the current or next fire season at any time,
 * once per season, through the same replayable chooseScenarioResponse action. The price scales to
 * the exposed system's monthly demand and the difficulty, so it is a meaningful tradeoff rather
 * than a fixed municipal figure. Returns undefined when the hazard does not apply.
 */
export function wildfirePreparedness(
  game: GameType,
): WildfirePreparednessType | undefined {
  if (!isWildfireHazardEligible(game)) {
    return undefined;
  }
  const profile = getWildfireProfile(game.location.id);
  if (!profile) {
    return undefined;
  }
  // Hazard checks run at each month's start, so next month is the first funding can still meet;
  // a season that ends this month has nothing left to cover, and the next one is on offer.
  const season = wildfireSeasonAt(
    profile,
    game.startingYear,
    game.date.monthsElapsed + 1,
  );
  const key = wildfirePreparednessKey(game.location.id, season.year);
  const funded = game.worldEvents.occurrences.some(
    (event) => event.key === key && event.attributes.choice === "prepare",
  );
  const firstCoveredMonth = Math.max(
    season.startMonth,
    game.date.monthsElapsed + 1,
  );
  const runEnd =
    getScenario(game.scenarioId, game.customScenario)?.durationMonths ??
    Infinity;
  const tooLate = firstCoveredMonth >= Math.min(season.endMonth, runEnd);
  // Priced per month of recent demand. A run's first months have little or no history to
  // average, so those fall back to the forecast's first month rather than pricing it at nothing.
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
  const exposedDemandMWh = monthlyDemandWh / 1e6;
  const costAt = (difficulty: DifficultyType): number =>
    Math.round(
      WILDFIRE_PREPAREDNESS_COST_PER_MWH *
        exposedDemandMWh *
        DIFFICULTIES[difficulty].buildCost,
    );
  return {
    profile,
    season,
    firstCoveredMonth,
    funded,
    tooLate: !funded && tooLate,
    cost: costAt(game.difficulty),
    choice:
      funded || tooLate
        ? undefined
        : {
            id: key,
            scenarioId: game.scenarioId,
            atMonth: game.date.monthsElapsed,
            title: "Wildfire preparedness",
            message: `Prepare ${game.location.name} for the fire season; restoration costs apply either way.`,
            options: [
              {
                id: "prepare",
                label: "Fund preparedness",
                cost: costAt,
                description:
                  "Halve customer disconnections and generator output losses if a wildfire starts before the season ends.",
                message: "Wildfire preparedness funded for the fire season.",
              },
            ],
          },
  };
}
