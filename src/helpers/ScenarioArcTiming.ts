import { SCENARIO_PREPARATION_MONTHS } from "../data/ScenarioPreparation";

/** Offsets are zero-based. Catalog load dates already include the preparation lead. */
export function relocateOfficialArcMonth(
  sourceScenarioId: number,
  offset: number,
  kind: "phase" | "choice" | "load",
): number {
  return (
    offset +
    (kind === "load" ? 0 : (SCENARIO_PREPARATION_MONTHS[sourceScenarioId] ?? 0))
  );
}
