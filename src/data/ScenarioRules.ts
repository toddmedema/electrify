import type {
  DifficultyType,
  FuelNameType,
  PricedFuelNameType,
  ScenarioLoadAdditionType,
  WorldEventEffectsType,
  GameEventKindType,
  ConceptNameType,
  GameEventImportanceType,
  StoryActionTargetType,
} from "../Types";

/** Authoring quantities use human units; compilation freezes one complete difficulty table. */
export type RuleNumber =
  number | { byDifficulty: Record<DifficultyType, number> };
export interface RuleCondition {
  arc?: number;
  choiceId: string;
  optionIds: string[];
}
export interface RuleLoadReference {
  arc?: number;
  loadId: string;
}
export type RuleSelector =
  | { selector: "largestOperating"; fuel?: FuelNameType }
  | { selector: "oldestOperating"; fuel: FuelNameType; count: number }
  | {
      selector: "seededOperatingCapacityShare";
      fuel?: FuelNameType;
      targetCapacityShare: RuleNumber;
    }
  | { selector: "operatingAtLeastAge"; fuel: FuelNameType; minAgeYears: number }
  | { selector: "startingAsset"; assetId: string };
export type ResolvedRuleSelector =
  | Exclude<RuleSelector, { selector: "seededOperatingCapacityShare" }>
  | {
      selector: "seededOperatingCapacityShare";
      fuel?: FuelNameType;
      targetCapacityShare: number;
    };
export interface RuleEffects {
  fuelPriceMultipliers?: Partial<Record<PricedFuelNameType, RuleNumber>>;
  outputMultipliersByFuel?: Partial<Record<FuelNameType, RuleNumber>>;
  /** These commuting operations are unordered; the compiler gives them a canonical order. */
  outputMultipliersBySelector?: {
    target: RuleSelector;
    outputMultiplier: RuleNumber;
  }[];
  demandMultiplier?: RuleNumber;
  temperatureOffsetC?: RuleNumber;
  hydroInflowMultiplier?: RuleNumber;
  constructionCostMultipliersByFuel?: Partial<Record<FuelNameType, RuleNumber>>;
  operatingCostMultipliersByFuel?: Partial<Record<FuelNameType, RuleNumber>>;
  operatingExpenseDollarsPerMonth?: RuleNumber;
  transactions?: { kind: "charge" | "grant"; amountDollars: RuleNumber }[];
  carbonFeeDollarsPerTonneCO2e?: RuleNumber;
}
/** Loads are permanent. Their own ID lets a choice replace only this schedule. */
export type RuleLoad = {
  id: string;
  startMonth: number;
  demandType: "Data Centers" | "Mining";
  loadFactor: number;
  supplementsBackground?: boolean;
} & (
  | { peakMW: number; peakShareOfStartingPeak?: never }
  | { peakShareOfStartingPeak: number; peakMW?: never }
);
export type RuleReport = {
  id: string;
  label?: string;
} & (
  | { kind: "affectedFacilities"; eventId: string }
  | {
      kind: "reliability";
      fromMonth: number;
      throughMonth: number;
      minDemandServedShare?: number;
    }
  | {
      kind: "fuelMix";
      fromMonth: number;
      throughMonth: number;
      fuels: FuelNameType[];
      /** Local generation by default; legacy reviews can compare delivered fuel to demand. */
      basis?: "localGeneration" | "customerDemand";
    }
  | {
      kind:
        | "firmCoverage"
        | "storageCoverage"
        | "profitLoss"
        | "dataCenter"
        | "deepFreeze";
      fromMonth: number;
      throughMonth: number;
    }
);
export interface RuleEvent {
  id: string;
  title: string;
  message: string;
  startMonth: number | { from: number; to: number };
  durationMonths?: RuleNumber | "untilEnd";
  visibility?: "forecast" | "surprise";
  preview?: string;
  endMessage?: string;
  requiresChoice?: RuleCondition;
  effects?: RuleEffects;
  loads?: RuleLoad[];
  report?: RuleReport;
  endReport?: RuleReport;
}
export interface RuleOption {
  id: string;
  label: string;
  description: string;
  message: string;
  costDollars?: RuleNumber;
  grantDollars?: RuleNumber;
  replaceLoad?: RuleLoadReference & { with: RuleLoad[] };
  /** Optional explicit links; events also declare their requiresChoice condition. */
  eventIds?: string[];
}
export interface RuleChoice {
  id: string;
  dueMonth: number;
  title: string;
  prompt: string;
  requiresChoice?: RuleCondition;
  options: RuleOption[];
}
type ObjectiveBase = { id: string; label: string; required?: boolean };
type ObjectiveWindow = { fromMonth: number; throughMonth: number };
export type RuleObjective = ObjectiveBase &
  (
    | (ObjectiveWindow & {
        metric: "monthlyReliability";
        minDemandServedShare: number;
      })
    | {
        metric: "customerRetention";
        minRetainedShare: number;
        deadlineMonth: number;
      }
    | (ObjectiveWindow & {
        metric: "emissionsBudget";
        budgetTonnesCO2e: number;
      })
    | (ObjectiveWindow & {
        metric: "emissionsPerDeliveredMWh";
        maxKgCO2ePerMWh: number;
      })
    | (ObjectiveWindow & {
        metric: "localFuelShare";
        fuels: FuelNameType[];
        minShare: number;
      })
    | { metric: "fuelRetirement"; fuel: FuelNameType; deadlineMonth: number }
    | (ObjectiveWindow & {
        metric: "monthlyBilledRate";
        maxDollarsPerKWh: number;
      })
    | (ObjectiveWindow & { metric: "monthEndDebt"; maxDebtDollars: number })
  );
export type RuleObjectiveIntent =
  | { mode: "inherit"; add?: RuleObjective[] }
  | { mode: "replace"; items: RuleObjective[] }
  | { mode: "none" };
export interface RuleArc {
  scenarioId: number;
  includeChoices: boolean;
}
export interface ScenarioRuleDefinitions {
  events?: RuleEvent[];
  choices?: RuleChoice[];
  objectives: RuleObjective[];
  debriefReports?: RuleReport[];
  officialArcs?: RuleArc[];
}
/** Engine months are zero-based; throughMonth remains inclusive. No authored quantities remain. */
export interface CompiledRuleLoad extends ScenarioLoadAdditionType {
  eventId: string;
  startMonth: number;
  requiresChoice?: RuleCondition;
}
export interface CompiledRuleEvent {
  id: string;
  key: string;
  title: string;
  message: string;
  startMonth: number;
  possibleStartMonths: { from: number; to: number };
  durationMonths: number;
  durationUntilEnd?: true;
  visibility: "forecast" | "surprise";
  preview?: string;
  endMessage?: string;
  requiresChoice?: RuleCondition;
  effects: WorldEventEffectsType;
  targets: { target: ResolvedRuleSelector; outputMultiplier: number }[];
  transactions: { kind: "charge" | "grant"; amount: number }[];
  report?: RuleReport;
  endReport?: RuleReport;
  /** Trusted catalog provenance, detached into the snapshot; never accepted in author data. */
  source?: {
    scenarioId: number;
    arcId: string;
    phaseId: string;
    drawKey?: string;
    kind?: GameEventKindType;
    concept?: ConceptNameType;
    importance?: GameEventImportanceType;
    actionTarget?: StoryActionTargetType;
    turningPointPriority?: number;
  };
  reports?: RuleReport[];
  protection?: { kind: "deepFreezeWinterization" | "wildfirePreparedness" };
}
export interface CompiledRuleOption {
  id: string;
  label: string;
  description: string;
  message: string;
  cost: number;
  grant: number;
  replaceLoad?: RuleLoadReference & { with: CompiledRuleLoad[] };
  eventIds?: string[];
}
export interface CompiledRuleChoice {
  id: string;
  key: string;
  dueMonth: number;
  title: string;
  prompt: string;
  requiresChoice?: RuleCondition;
  options: CompiledRuleOption[];
  freeOptionId: string;
  automatic?: boolean;
}
export type CompiledRuleObjective = ObjectiveBase & {
  required: boolean;
  inherited?: boolean;
} & (
    | (ObjectiveWindow & {
        metric: "monthlyReliability";
        minDemandServedShare: number;
      })
    | {
        metric: "customerRetention";
        minRetainedShare: number;
        deadlineMonth: number;
      }
    | (ObjectiveWindow & { metric: "emissionsBudget"; budgetKgCO2e: number })
    | (ObjectiveWindow & {
        metric: "emissionsPerDeliveredMWh";
        maxKgCO2ePerMWh: number;
      })
    | (ObjectiveWindow & {
        metric: "localFuelShare";
        fuels: FuelNameType[];
        minShare: number;
      })
    | { metric: "fuelRetirement"; fuel: FuelNameType; deadlineMonth: number }
    | (ObjectiveWindow & {
        metric: "monthlyBilledRate";
        maxDollarsPerKWh: number;
      })
    | (ObjectiveWindow & { metric: "monthEndDebt"; maxDebt: number })
  );
export interface CompiledScenarioRules {
  runtimeVersion: 1;
  namespace:
    | { kind: "mod"; id: string }
    | { kind: "official"; scenarioId: number; arcId: string };
  difficulty: DifficultyType;
  seed: number;
  startingYear: number;
  durationMonths: number;
  startingPeakW: number;
  startingAssetIds: string[];
  officialArcs: RuleArc[];
  events: CompiledRuleEvent[];
  arcEvents?: CompiledRuleEvent[];
  choices: CompiledRuleChoice[];
  objectives: CompiledRuleObjective[];
  loads: CompiledRuleLoad[];
  debriefReports: RuleReport[];
}
export interface RuleDiagnostic {
  code: string;
  path: string;
  severity: "error" | "warning";
  message: string;
}
