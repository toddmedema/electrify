import type {
  RuleArc,
  RuleChoice,
  RuleEvent,
  RuleObjective,
  RuleReport,
} from "../data/ScenarioRules";
// Types for ModSchema.js. ModSchema.test.ts checks every key list below against these types and
// the facility catalog, so the JavaScript validator and the TypeScript model cannot drift apart.
import type {
  FacilityModifierType,
  LocationType,
  ModFacilityNameType,
  ScenarioModType,
  ScenarioType,
} from "../Types";

export type ModScenarioOverrides = Partial<
  Pick<
    ScenarioType,
    | "cash"
    | "startingYear"
    | "startingCustomers"
    | "startingDemandScale"
    | "dollarsPerkWh"
    | "durationMonths"
    | "feePerKgCO2e"
    | "ownership"
    | "endTitle"
    | "endMessage"
  >
> & { location?: LocationType; startingFleet?: ModStartingFacility[] };
export type ModStartingFacility = {
  id?: string;
  ageYears?: number;
  hydroSiteId?: string;
  reservoirFraction?: number;
} & (
  | {
      name: Exclude<
        ModFacilityNameType,
        "Battery" | "Iron-Air Battery" | "Pumped Hydro"
      >;
      peakMW: number;
      peakMWh?: never;
    }
  | {
      name: "Battery" | "Iron-Air Battery" | "Pumped Hydro";
      peakMW?: number;
      peakMWh: number;
    }
);

export type ModProgramId = keyof NonNullable<ScenarioModType["programs"]>;

/** The authoring and sharing format. Runs keep only ScenarioModType, never this package. */
export interface ModPackage {
  schemaVersion: 1;
  gameApi: number;
  id: string;
  title: string;
  creator: string;
  version: string;
  description: string;
  $schema?: string;
  seed?: number;
  baseScenarioId?: number;
  scenario?: ModScenarioOverrides;
  facilities?: Partial<Record<ModFacilityNameType, FacilityModifierType>>;
  programs?: Partial<Record<ModProgramId, number>>;
  officialArcs?: RuleArc[];
  events?: RuleEvent[];
  choices?: RuleChoice[];
  objectives?: RuleObjective[];
  debriefReports?: RuleReport[];
}

export interface ModDiagnostic {
  code: string;
  path: string;
  severity: "error" | "warning";
  message: string;
}
export class ModValidationError extends Error {
  constructor(diagnostics: ModDiagnostic[]);
  diagnostics: ModDiagnostic[];
}
export function modDiagnostics(value: unknown): ModDiagnostic[];
export const MOD_API_VERSION: number;
export const MAX_MOD_BYTES: number;
export const MOD_SCENARIO_IDS: readonly number[];
export const FACILITY_NAMES: readonly ModFacilityNameType[];
export const SCENARIO_OVERRIDE_KEYS: readonly (keyof ModScenarioOverrides)[];
export const FACILITY_MODIFIER_KEYS: readonly (keyof FacilityModifierType)[];
export const PROGRAM_KEYS: readonly ModProgramId[];
export function parseMod(input: string): ModPackage;
export function validateMod(value: unknown): ModPackage;

export function packageDigest(value: unknown): string;
