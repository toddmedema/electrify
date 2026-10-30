import type { CompiledRuleObjective } from "./ScenarioRules";
import type { FuelNameType, MonthlyHistoryType } from "../Types";

export type ObjectiveStatus =
  "pending" | "inProgress" | "completed" | "failed" | "unverifiable";

/** Values use the compiled objective's units, including kg CO2e and starting-year dollars. */
export interface ObjectiveResult {
  objective: CompiledRuleObjective;
  id: string;
  metric: CompiledRuleObjective["metric"];
  label: string;
  required: boolean;
  definition: string;
  status: ObjectiveStatus;
  observed?: number;
  target: number;
  observedMonths: number;
  requiredMonths: number;
  reason?: string;
}

/** Only completed-month facts enter this context; current forecast frames are not evidence. */
export interface ObjectiveContext {
  rulesDigest: string;
  startingYear: number;
  seed: number;
  durationMonths: number;
  ownership: "Investor" | "Public";
  completedMonths: number;
  marketSize?: number;
}

export interface ObjectiveMonthFacts {
  /** Zero-based completed month. */
  month: number;
  history: MonthlyHistoryType;
  /** Actual getTotalDebt principal at close, not an expense or a forecast. */
  debtPrincipal?: number;
  /** Counts every owned asset, including paused and unfinished facilities. */
  ownedFuels?: Partial<Record<FuelNameType, number>>;
  ownedUtilities?: string[];
  /** Stable original equipment identities still owned at this month close. */
  ownedAssetIds?: string[];
  /** Lowest current/transfer ratio among the original and every acquired cohort. */
  minimumCohortRetention?: number;
}

/** Missing/invalid observations are explicit nulls, never zero or a passing ratio. */
export type ObjectiveObservation = [
  month: number,
  numerator: number | null,
  denominator: number | null,
];

export interface ObjectiveEvidence {
  id: string;
  observations: ObjectiveObservation[];
  /** A consistency chain over the canonical observations, not an authentication signature. */
  digest: string;
  duplicateMonths: number[];
}

/** At most sixteen objectives and 1200 compact observations for each objective. */
export interface ObjectiveProgress {
  version: 1;
  rulesDigest: string;
  retentionBaseline: number;
  completedMonths: number;
  entries: ObjectiveEvidence[];
  /** Binds the context, observation chains and duplicate evidence against one-field edits. */
  checksum: string;
}
