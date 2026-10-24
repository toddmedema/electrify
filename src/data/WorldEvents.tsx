import type {
  ActiveWorldEventType,
  ConceptNameType,
  DateType,
  DifficultyType,
  GameEventImportanceType,
  GameEventKindType,
  LocationType,
  StoryAttributeValueType,
  StoryPeriodSnapshotType,
  StorySnapshotType,
  StoryActionTargetType,
  WorldEventEffectsType,
  MonthlyHistoryType,
} from "../Types";
import type { CompiledScenarioRules } from "./ScenarioRules";
import { getScenario } from "./Scenarios";
import { officialScenarioRules } from "../helpers/ScenarioRules";
import {
  resolveScenarioRuleEvents,
  upcomingScenarioRuleEvents,
} from "../helpers/ScenarioRuleRuntime";
import { LOAD_SHEDDING_BALANCE } from "./OfficialScenarioRules";
import {
  SHALE_BOOM_BALANCE,
  CARBON_FEE_BALANCE,
  PARADISE_BALANCE,
  RENEWABLES_BALANCE,
  TEXAS_DEEP_FREEZE_DEMAND,
  HEATWAVE_DROUGHT_BALANCE,
  KARIBA_DROUGHT_BALANCE,
  DELHI_SUMMER_BALANCE,
} from "./OfficialScenarioEffectRules";
import {
  HURRICANE_BALANCE,
  END_OF_ERA_BALANCE,
} from "./OfficialScenarioTargetRules";
import { WINTERIZATION_COST } from "./ScenarioChoiceRules";
export * from "./OfficialScenarioEffectRules";
export * from "./OfficialScenarioTargetRules";
export { LOAD_SHEDDING_BALANCE } from "./OfficialScenarioRules";
export {
  DEEP_FREEZE_DECISION_KEY,
  WINTERIZATION_COST,
} from "./ScenarioChoiceRules";
export interface StoryContextType {
  rules?: CompiledScenarioRules;
  monthlyHistory?: MonthlyHistoryType[];
  completedMonths?: number;
  startingRateDollarsPerKWh?: number;
  endingRateDollarsPerKWh?: number;
  customEvents?: Array<{ scenarioId: number; moneyScale: number }>;
  seed: number;
  scenarioId: number;
  difficulty: DifficultyType;
  date: DateType;
  location: LocationType;
  snapshot: StorySnapshotType;
  /** Exact completed-month summaries used by short recovery phases. */
  periodSnapshots?: Partial<Record<number, StoryPeriodSnapshotType>>;
  /** Previously persisted live resolutions, including expired onsets. */
  occurrences?: ActiveWorldEventType[];
}

export interface StoryPhaseDescriptionType {
  title?: string;
  message: string;
  concept?: ConceptNameType;
  kind: GameEventKindType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
  attributes?: Record<string, StoryAttributeValueType>;
  effects?: WorldEventEffectsType;
  turningPointPriority?: number;
}

export interface ResolvedStoryType {
  /** Phases whose scheduled month is the requested date, suitable for live persistence/logging. */
  occurrences: Array<ActiveWorldEventType & StoryPhaseDescriptionType>;
  /** Scheduled phases whose effect window contains the requested date. */
  active: Array<ActiveWorldEventType & StoryPhaseDescriptionType>;
  effects: WorldEventEffectsType;
}

const DIFFICULTY_ORDER: DifficultyType[] = [
  "Intern",
  "Employee",
  "Manager",
  "VP",
  "CEO",
];

export const winterizationCost = (difficulty: DifficultyType) =>
  WINTERIZATION_COST[difficulty];

export function validateStoryDifficultyMonotonicity(): string[] {
  const problems: string[] = [];
  const ascending = (name: string, values: number[]) => {
    if (values.some((value, index) => index > 0 && value < values[index - 1])) {
      problems.push(`${name} must not decrease from Intern to CEO`);
    }
  };
  const descending = (name: string, values: number[]) => {
    if (values.some((value, index) => index > 0 && value > values[index - 1])) {
      problems.push(`${name} must not increase from Intern to CEO`);
    }
  };
  ascending(
    "Carbon fee",
    DIFFICULTY_ORDER.map((difficulty) => CARBON_FEE_BALANCE[difficulty]),
  );
  ascending(
    "Shale boom price",
    DIFFICULTY_ORDER.map(
      (difficulty) => SHALE_BOOM_BALANCE[difficulty].boomGasMultiplier,
    ),
  );
  ascending(
    "Shale freeze surcharge",
    DIFFICULTY_ORDER.map(
      (difficulty) => SHALE_BOOM_BALANCE[difficulty].freezeSurcharge,
    ),
  );
  descending(
    "Shale freeze output",
    DIFFICULTY_ORDER.map(
      (difficulty) => SHALE_BOOM_BALANCE[difficulty].freezeGasOutput,
    ),
  );
  ascending(
    "Paradise visitor demand",
    DIFFICULTY_ORDER.map(
      (difficulty) => PARADISE_BALANCE[difficulty].visitorDemand,
    ),
  );
  ascending(
    "Paradise oil shock",
    DIFFICULTY_ORDER.map((difficulty) => PARADISE_BALANCE[difficulty].oilShock),
  );
  ascending(
    "Renewables bridge gas cost",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].bridgeGasBuildCost,
    ),
  );
  ascending(
    "Renewables solar cost",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].solarBuildCost,
    ),
  );
  ascending(
    "Renewables wind cost",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].windBuildCost,
    ),
  );
  ascending(
    "Renewables demand",
    DIFFICULTY_ORDER.map(
      (difficulty) => RENEWABLES_BALANCE[difficulty].demandLoad,
    ),
  );
  ascending(
    "Texas deep freeze demand",
    DIFFICULTY_ORDER.map((difficulty) => TEXAS_DEEP_FREEZE_DEMAND[difficulty]),
  );
  ([0, 1, 2] as const).forEach((month) => {
    ascending(
      `Heatwave month ${month + 1} demand`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].demandMultipliers[month],
      ),
    );
    descending(
      `Heatwave month ${month + 1} hydro runoff`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].hydroRunoffMultipliers[month],
      ),
    );
    descending(
      `Heatwave month ${month + 1} hydro output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].hydroOutputMultipliers[month],
      ),
    );
    descending(
      `Heatwave month ${month + 1} nuclear output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          HEATWAVE_DROUGHT_BALANCE[difficulty].nuclearOutputMultipliers[month],
      ),
    );
  });
  ascending(
    "Hurricane affected capacity",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].targetCapacityShare,
    ),
  );
  descending(
    "Hurricane output",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].outputMultiplier,
    ),
  );
  ascending(
    "Hurricane duration",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].durationMonths,
    ),
  );
  ascending(
    "Hurricane oil",
    DIFFICULTY_ORDER.map(
      (difficulty) => HURRICANE_BALANCE[difficulty].oilMultiplier,
    ),
  );
  descending(
    "Old coal output",
    DIFFICULTY_ORDER.map(
      (difficulty) => END_OF_ERA_BALANCE[difficulty].oldCoalOutput,
    ),
  );
  ascending(
    "Coal O&M",
    DIFFICULTY_ORDER.map((difficulty) => END_OF_ERA_BALANCE[difficulty].coalOM),
  );
  descending(
    "Compliance coal output",
    DIFFICULTY_ORDER.map(
      (difficulty) => END_OF_ERA_BALANCE[difficulty].complianceCoalOutput,
    ),
  );
  ([0, 1, 2, 3] as const).forEach((step) => {
    descending(
      `Load shedding step ${step + 1} coal output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          LOAD_SHEDDING_BALANCE[difficulty].coalOutputMultipliers[step],
      ),
    );
    ascending(
      `Load shedding step ${step + 1} coal operating cost`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          LOAD_SHEDDING_BALANCE[difficulty].coalOperatingMultipliers[step],
      ),
    );
    ascending(
      `Load shedding step ${step + 1} diesel price`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          LOAD_SHEDDING_BALANCE[difficulty].dieselPriceMultipliers[step],
      ),
    );
    descending(
      `Kariba step ${step + 1} runoff`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          KARIBA_DROUGHT_BALANCE[difficulty].hydroRunoffMultipliers[step],
      ),
    );
    descending(
      `Kariba step ${step + 1} hydro output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          KARIBA_DROUGHT_BALANCE[difficulty].hydroOutputMultipliers[step],
      ),
    );
  });
  ([0, 1, 2, 3] as const).forEach((summer) => {
    ascending(
      `Delhi summer ${summer + 1} demand`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          DELHI_SUMMER_BALANCE[difficulty].demandMultipliers[summer],
      ),
    );
    descending(
      `Delhi summer ${summer + 1} thermal output`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          DELHI_SUMMER_BALANCE[difficulty].thermalOutputMultipliers[summer],
      ),
    );
    ascending(
      `Delhi summer ${summer + 1} temperature`,
      DIFFICULTY_ORDER.map(
        (difficulty) =>
          DELHI_SUMMER_BALANCE[difficulty].temperatureOffsetC[summer],
      ),
    );
  });
  return problems;
}

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
      result[key as keyof T] = ((result[key] ?? 1) * multiplier) as T[keyof T];
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
    if (
      combined.hydroRunoffMultiplier !== undefined ||
      effects.hydroRunoffMultiplier !== undefined
    ) {
      combined.hydroRunoffMultiplier =
        (combined.hydroRunoffMultiplier ?? 1) *
        (effects.hydroRunoffMultiplier ?? 1);
    }
    const fuelPriceMultipliers = multiplyEffects(
      combined.fuelPriceMultipliers,
      effects.fuelPriceMultipliers,
    );
    if (fuelPriceMultipliers !== undefined) {
      combined.fuelPriceMultipliers = fuelPriceMultipliers;
    }
    const buildCostMultipliersByFuel = multiplyEffects(
      combined.buildCostMultipliersByFuel,
      effects.buildCostMultipliersByFuel,
    );
    if (buildCostMultipliersByFuel !== undefined) {
      combined.buildCostMultipliersByFuel = buildCostMultipliersByFuel;
    }
    const operatingCostMultipliersByFuel = multiplyEffects(
      combined.operatingCostMultipliersByFuel,
      effects.operatingCostMultipliersByFuel,
    );
    if (operatingCostMultipliersByFuel !== undefined) {
      combined.operatingCostMultipliersByFuel = operatingCostMultipliersByFuel;
    }
    if (
      combined.operatingExpensePerMonth !== undefined ||
      effects.operatingExpensePerMonth !== undefined
    ) {
      combined.operatingExpensePerMonth =
        (combined.operatingExpensePerMonth || 0) +
        (effects.operatingExpensePerMonth || 0);
    }
    const facilityOutputMultipliersByFuel = multiplyEffects(
      combined.facilityOutputMultipliersByFuel,
      effects.facilityOutputMultipliersByFuel,
    );
    if (facilityOutputMultipliersByFuel !== undefined) {
      combined.facilityOutputMultipliersByFuel =
        facilityOutputMultipliersByFuel;
    }
    if (effects.transmissionCapacityLimitsWByCorridor)
      for (const [id, limitW] of Object.entries(
        effects.transmissionCapacityLimitsWByCorridor,
      ))
        (combined.transmissionCapacityLimitsWByCorridor ??= {})[id] = Math.min(
          combined.transmissionCapacityLimitsWByCorridor?.[id] ?? Infinity,
          limitW,
        );
    const facilityOutputMultipliersById = multiplyEffects(
      combined.facilityOutputMultipliersById,
      effects.facilityOutputMultipliersById,
    );
    if (facilityOutputMultipliersById !== undefined) {
      combined.facilityOutputMultipliersById = facilityOutputMultipliersById;
    }
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

/** Catalog setup and the caller's actual run context select shared plain compiled rules. */
function storyRules(context: StoryContextType): CompiledScenarioRules[] {
  if (context.rules) return [context.rules];
  const ids =
    context.scenarioId === 999
      ? (context.customEvents?.map((event) => event.scenarioId) ?? [])
      : [context.scenarioId];
  return ids.flatMap((id) => {
    const source = getScenario(id);
    if (!source || source.tutorialSteps) return [];
    const rules = officialScenarioRules(source, context, {
      startingYear:
        context.date.year - Math.floor(context.date.monthsElapsed / 12),
    });
    return rules ? [rules] : [];
  });
}

/** Live, forecast, headless and custom historical arcs share one interpreter. */
export function resolveStoryAtDate(
  context: StoryContextType,
): ResolvedStoryType {
  const occurrences: ResolvedStoryType["occurrences"] = [],
    active: ResolvedStoryType["active"] = [];
  for (const rules of storyRules(context)) {
    const resolved = resolveScenarioRuleEvents({ ...context, rules });
    occurrences.push(...resolved.occurrences);
    active.push(...resolved.active);
  }
  const order = (a: ActiveWorldEventType, b: ActiveWorldEventType) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  occurrences.sort(order);
  active.sort(order);
  return { occurrences, active, effects: combineStoryEffects(active) };
}

/** Forecast copy is resolved by the same owner without recording activation or observation. */
export function upcomingStoryPhases(
  context: StoryContextType,
): Array<ActiveWorldEventType & StoryPhaseDescriptionType> {
  return storyRules(context)
    .flatMap((rules) => upcomingScenarioRuleEvents({ ...context, rules }))
    .sort(
      (a, b) => a.startsMinute - b.startsMinute || a.key.localeCompare(b.key),
    );
}
