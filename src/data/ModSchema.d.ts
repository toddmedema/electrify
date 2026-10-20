export interface ModPackage {
  schemaVersion: 1;
  id: string;
  title: string;
  creator: string;
  version: string;
  rules: string;
  seed: number;
  baseScenarioId: number;
  scenario?: Partial<
    Pick<
      import("../Types").ScenarioType,
      | "cash"
      | "startingYear"
      | "startingCustomers"
      | "startingDemandScale"
      | "dollarsPerkWh"
      | "durationMonths"
      | "feePerKgCO2e"
      | "eventScenarioIds"
      | "ownership"
      | "endTitle"
      | "endMessage"
    >
  >;
  facilities?: Record<
    string,
    Partial<
      Record<"buildCost" | "annualOperatingCost" | "yearsToBuild", number>
    >
  >;
  programs?: Partial<Record<"efficiency" | "solar", number>>;
  notifications?: { month: number; title: string; message: string }[];
}
export const MAX_MOD_BYTES: number;
export function parseMod(input: string): ModPackage;

export const MOD_SCENARIO_IDS: readonly number[];
