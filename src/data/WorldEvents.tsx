import {
  ActiveWorldEventType,
  CardNameType,
  DateType,
  DifficultyType,
  GameEventImportanceType,
  GameEventKindType,
  LocationType,
  StorySnapshotType,
  WorldEventEffectsType,
} from "../Types";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { randomAt, RANDOM_STREAM } from "../helpers/Math";

export interface StoryContextType {
  seed: number;
  scenarioId: number;
  difficulty: DifficultyType;
  date: DateType;
  location: LocationType;
  snapshot: StorySnapshotType;
}

export type StoryScheduleType =
  | { atMonth: number }
  | {
      seededMonthRange: { firstMonth: number; lastMonth: number };
      randomKey: string;
    };

export type StoryRandomType = (attribute: string) => number;

export interface StoryPhaseDescriptionType {
  message: string;
  kind: GameEventKindType;
  importance?: GameEventImportanceType;
  actionTarget?: CardNameType;
  attributes?: Record<string, string | number>;
  effects?: WorldEventEffectsType;
}

export interface StoryPhaseDefinitionType {
  id: string;
  schedule: StoryScheduleType;
  /** Zero (the default) logs a point-in-time phase without applying lasting effects. */
  durationMonths?: number;
  describe: (
    context: StoryContextType,
    random: StoryRandomType,
  ) => StoryPhaseDescriptionType;
}

export interface StoryArcDefinitionType {
  id: string;
  scenarioId: number;
  phases: StoryPhaseDefinitionType[];
}

export interface ResolvedStoryType {
  /** Phases whose scheduled month is the requested date, suitable for live persistence/logging. */
  occurrences: Array<ActiveWorldEventType & StoryPhaseDescriptionType>;
  /** Scheduled phases whose effect window contains the requested date. */
  active: Array<ActiveWorldEventType & StoryPhaseDescriptionType>;
  effects: WorldEventEffectsType;
}

// Foundation only. Scenario content is deliberately delivered in the later, separately balanced
// PRs listed by issue #250.
export const STORY_ARC_DEFINITIONS: StoryArcDefinitionType[] = [];

/** Stable 32-bit address for a string, independent of definition and facility array order. */
export function storyHash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result | 0;
}

export function storyPhaseKey(
  scenarioId: number,
  arcId: string,
  phaseId: string,
): string {
  return `story:${scenarioId}:${arcId}:${phaseId}`;
}

export function resolveStoryScheduleMonth(
  schedule: StoryScheduleType,
  seed: number,
  stableKey: string,
): number {
  if ("atMonth" in schedule) {
    return schedule.atMonth;
  }
  const { firstMonth, lastMonth } = schedule.seededMonthRange;
  if (lastMonth < firstMonth) {
    throw new Error(`Invalid seeded story schedule for ${stableKey}`);
  }
  const count = lastMonth - firstMonth + 1;
  return (
    firstMonth +
    Math.floor(
      randomAt(
        seed,
        RANDOM_STREAM.worldEvents,
        storyHash(`${stableKey}|${schedule.randomKey}`),
      ) * count,
    )
  );
}

function multiplyEffects<T extends Partial<Record<string, number>>>(
  target: T | undefined,
  source: T | undefined,
): T | undefined {
  if (!source) {
    return target;
  }
  const result = (target || {}) as T;
  Object.entries(source).forEach(([key, multiplier]) => {
    if (multiplier !== undefined) {
      result[key as keyof T] = ((result[key] || 1) * multiplier) as T[keyof T];
    }
  });
  return result;
}

/** Explicit composition semantics shared by persisted live occurrences and forecast resolution. */
export function combineStoryEffects(
  occurrences: Array<{ effects: WorldEventEffectsType }>,
): WorldEventEffectsType {
  const combined: WorldEventEffectsType = {};
  occurrences.forEach(({ effects }) => {
    combined.temperatureOffsetC =
      (combined.temperatureOffsetC || 0) + (effects.temperatureOffsetC || 0);
    combined.demandMultiplier =
      (combined.demandMultiplier || 1) * (effects.demandMultiplier || 1);
    combined.fuelPriceMultipliers = multiplyEffects(
      combined.fuelPriceMultipliers,
      effects.fuelPriceMultipliers,
    );
    combined.buildCostMultipliersByFuel = multiplyEffects(
      combined.buildCostMultipliersByFuel,
      effects.buildCostMultipliersByFuel,
    );
    combined.operatingCostMultipliersByFuel = multiplyEffects(
      combined.operatingCostMultipliersByFuel,
      effects.operatingCostMultipliersByFuel,
    );
    combined.facilityOutputMultipliersByFuel = multiplyEffects(
      combined.facilityOutputMultipliersByFuel,
      effects.facilityOutputMultipliersByFuel,
    );
    combined.facilityOutputMultipliersById = multiplyEffects(
      combined.facilityOutputMultipliersById,
      effects.facilityOutputMultipliersById,
    );
    if (effects.carbonFeePerKgCO2e !== undefined) {
      if (
        combined.carbonFeePerKgCO2e !== undefined &&
        combined.carbonFeePerKgCO2e !== effects.carbonFeePerKgCO2e
      ) {
        throw new Error("Overlapping story carbon-fee overrides");
      }
      combined.carbonFeePerKgCO2e = effects.carbonFeePerKgCO2e;
    }
  });
  return combined;
}

function resolvePhase(
  arc: StoryArcDefinitionType,
  phase: StoryPhaseDefinitionType,
  context: StoryContextType,
): ActiveWorldEventType & StoryPhaseDescriptionType {
  const key = storyPhaseKey(arc.scenarioId, arc.id, phase.id);
  const scheduledMonth = resolveStoryScheduleMonth(
    phase.schedule,
    context.seed,
    key,
  );
  const random = (attribute: string) =>
    randomAt(
      context.seed,
      RANDOM_STREAM.worldEvents,
      storyHash(`${key}|${attribute}`),
    );
  const description = phase.describe(context, random);
  const startsMinute = scheduledMonth * MINUTES_PER_MONTH;
  return {
    key,
    definitionId: `${arc.id}:${phase.id}`,
    startsMinute,
    endsMinute: startsMinute + (phase.durationMonths || 0) * MINUTES_PER_MONTH,
    ...description,
    attributes: {
      scheduledMonth,
      ...(description.attributes || {}),
    },
    effects: description.effects || {},
  };
}

/**
 * Pure story resolver used at both live monthly rollover and every date in a forecast. It never
 * mutates checked keys, occurrences, logs, snackbars, recovery state, facilities, or speed.
 */
export function resolveStoryAtDate(
  context: StoryContextType,
  definitions: StoryArcDefinitionType[] = STORY_ARC_DEFINITIONS,
): ResolvedStoryType {
  const occurrences: ResolvedStoryType["occurrences"] = [];
  const active: ResolvedStoryType["active"] = [];
  definitions
    // This explicit equality is the scenario boundary. Custom games (id 999) cannot inherit
    // authored content by sharing a location or starting year with one of the scored scenarios.
    .filter((arc) => arc.scenarioId === context.scenarioId)
    .flatMap((arc) => arc.phases.map((phase) => ({ arc, phase })))
    // Persisted occurrence order is part of save/replay determinism too, so content-file order is
    // not allowed to decide it.
    .sort((a, b) =>
      storyPhaseKey(a.arc.scenarioId, a.arc.id, a.phase.id).localeCompare(
        storyPhaseKey(b.arc.scenarioId, b.arc.id, b.phase.id),
      ),
    )
    .forEach(({ arc, phase }) => {
      const resolved = resolvePhase(arc, phase, context);
      const scheduledMonth = resolved.attributes.scheduledMonth as number;
      if (context.date.monthsElapsed === scheduledMonth) {
        occurrences.push(resolved);
      }
      if (
        context.date.minute >= resolved.startsMinute &&
        context.date.minute < resolved.endsMinute
      ) {
        active.push(resolved);
      }
    });
  return { occurrences, active, effects: combineStoryEffects(active) };
}

export function activeWorldEventEffects(
  events: ActiveWorldEventType[] | undefined,
  minute: number,
): WorldEventEffectsType {
  return combineStoryEffects(
    (events || []).filter(
      (event) => minute >= event.startsMinute && minute < event.endsMinute,
    ),
  );
}
