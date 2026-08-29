import {
  ActiveWorldEventType,
  ConceptNameType,
  DateType,
  DifficultyType,
  GameEventImportanceType,
  GameEventKindType,
  LocationType,
  StorySnapshotType,
  StoryActionTargetType,
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
  title?: string;
  message: string;
  details?: string;
  concept?: ConceptNameType;
  kind: GameEventKindType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
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

export interface ShaleBoomBalanceType {
  boomGasMultiplier: number;
  freezeSurcharge: number;
  freezeGasOutput: number;
}

export const SHALE_BOOM_BALANCE: Record<DifficultyType, ShaleBoomBalanceType> =
  {
    Intern: {
      boomGasMultiplier: 0.7,
      freezeSurcharge: 1.5,
      freezeGasOutput: 0.8,
    },
    Employee: {
      boomGasMultiplier: 0.725,
      freezeSurcharge: 1.65,
      freezeGasOutput: 0.75,
    },
    Manager: {
      boomGasMultiplier: 0.75,
      freezeSurcharge: 1.8,
      freezeGasOutput: 0.7,
    },
    VP: {
      boomGasMultiplier: 0.775,
      freezeSurcharge: 1.95,
      freezeGasOutput: 0.65,
    },
    CEO: {
      boomGasMultiplier: 0.8,
      freezeSurcharge: 2.1,
      freezeGasOutput: 0.6,
    },
  };

const FUEL_PRICE_TARGET: StoryActionTargetType = {
  card: "INSIGHTS",
  layer: "FUEL_PRICES",
};

const SHALE_BOOM_ARC: StoryArcDefinitionType = {
  id: "shale-boom",
  scenarioId: 103,
  phases: [
    {
      id: "regional-glut-warning",
      schedule: { atMonth: 12 },
      describe: () => ({
        title: "Regional gas boom forecast",
        message:
          "New shale production is expected to push natural gas prices down in Jan 2010.",
        details:
          "The discount is temporary. Compare flexible gas capacity with alternatives that are less exposed to fuel prices.",
        concept: "fuel",
        kind: "WORLD_EVENT",
        importance: "NOTABLE",
        actionTarget: FUEL_PRICE_TARGET,
      }),
    },
    {
      id: "regional-glut",
      schedule: { atMonth: 48 },
      durationMonths: 74,
      describe: ({ difficulty }) => {
        const { boomGasMultiplier } = SHALE_BOOM_BALANCE[difficulty];
        return {
          title: "Regional gas glut",
          message: `Natural gas prices fall ${Math.round((1 - boomGasMultiplier) * 100)}% through Feb 2016.`,
          details: `Difficulty-adjusted gas-price multiplier: ${boomGasMultiplier.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}×.`,
          concept: "fuel",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FUEL_PRICE_TARGET,
          attributes: { boomGasMultiplier },
          effects: {
            fuelPriceMultipliers: { "Natural Gas": boomGasMultiplier },
          },
        };
      },
    },
    {
      id: "freeze-warning",
      schedule: { atMonth: 95 },
      describe: ({ difficulty }) => {
        const { freezeGasOutput, freezeSurcharge } =
          SHALE_BOOM_BALANCE[difficulty];
        return {
          title: "Winter gas squeeze warning",
          message: `A Jan–Mar 2014 freeze could raise gas prices and cap gas generation at ${Math.round(freezeGasOutput * 100)}% output.`,
          details: `The freeze surcharge will be ${freezeSurcharge.toFixed(2).replace(/0$/, "")}×, stacked with the continuing shale discount.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "NOTABLE",
          actionTarget: FUEL_PRICE_TARGET,
        };
      },
    },
    {
      id: "freeze",
      schedule: { atMonth: 96 },
      durationMonths: 3,
      describe: ({ difficulty }) => {
        const balance = SHALE_BOOM_BALANCE[difficulty];
        const effectiveMultiplier =
          balance.boomGasMultiplier * balance.freezeSurcharge;
        return {
          title: "Winter gas squeeze",
          message: `Gas is ${Math.round(Math.abs(effectiveMultiplier - 1) * 100)}% ${effectiveMultiplier >= 1 ? "above" : "below"} normal and all gas plants are capped at ${Math.round(balance.freezeGasOutput * 100)}% output through Mar 2014.`,
          details: `${balance.boomGasMultiplier.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}× shale price × ${balance.freezeSurcharge.toFixed(2).replace(/0$/, "")}× freeze surcharge = ${effectiveMultiplier.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}× effective gas price.`,
          concept: "danger",
          kind: "WORLD_EVENT",
          importance: "CRITICAL",
          actionTarget: FUEL_PRICE_TARGET,
          attributes: {
            freezeSurcharge: balance.freezeSurcharge,
            freezeGasOutput: balance.freezeGasOutput,
            effectiveGasPriceMultiplier: effectiveMultiplier,
          },
          effects: {
            fuelPriceMultipliers: {
              "Natural Gas": balance.freezeSurcharge,
            },
            facilityOutputMultipliersByFuel: {
              "Natural Gas": balance.freezeGasOutput,
            },
          },
        };
      },
    },
    {
      id: "normalization",
      schedule: { atMonth: 122 },
      describe: () => ({
        title: "Gas market normalization",
        message:
          "Regional natural gas prices return to normal after the shale glut.",
        details:
          "Review how much of the grid now depends on gas before the next market cycle.",
        concept: "fuel",
        kind: "WORLD_EVENT",
        importance: "ROUTINE",
        actionTarget: FUEL_PRICE_TARGET,
      }),
    },
  ],
};

export const STORY_ARC_DEFINITIONS: StoryArcDefinitionType[] = [SHALE_BOOM_ARC];

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

export function resolveStoryPhase(
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
      const resolved = resolveStoryPhase(arc, phase, context);
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

/** Future authored phases for presentation only; these never participate in effect aggregation. */
export function upcomingStoryPhases(
  context: StoryContextType,
  definitions: StoryArcDefinitionType[] = STORY_ARC_DEFINITIONS,
): Array<ActiveWorldEventType & StoryPhaseDescriptionType> {
  return definitions
    .filter((arc) => arc.scenarioId === context.scenarioId)
    .flatMap((arc) =>
      arc.phases.map((phase) => resolveStoryPhase(arc, phase, context)),
    )
    .filter(
      (phase) =>
        (phase.attributes.scheduledMonth as number) >
        context.date.monthsElapsed,
    )
    .sort(
      (a, b) => a.startsMinute - b.startsMinute || a.key.localeCompare(b.key),
    );
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
