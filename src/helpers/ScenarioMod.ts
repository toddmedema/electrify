import type {
  FacilityModifierType,
  GameType,
  ModFacilityNameType,
  ScenarioModType,
  ScenarioNoticeType,
  ScenarioType,
} from "../Types";

/** A mod's multipliers for one catalog facility; unmodded runs and unknown names get none. */
export function facilityModifier(
  game: Pick<GameType, "customScenario">,
  name: string,
): FacilityModifierType | undefined {
  return game.customScenario?.mod?.facilities?.[name as ModFacilityNameType];
}

/** Mod notices due this month, with the stable key that reports each one once. */
export function modNotificationsDue(
  game: Pick<GameType, "customScenario" | "date">,
): { notice: ScenarioNoticeType; key: string }[] {
  return (game.customScenario?.mod?.notifications || []).flatMap(
    (notice, index) =>
      notice.month === game.date.monthsElapsed
        ? [{ notice, key: `mod-notice:${index}` }]
        : [],
  );
}

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const factor = (value: unknown) =>
  value === undefined ||
  (typeof value === "number" && Number.isFinite(value) && value > 0);
const string = (value: unknown) => typeof value === "string";

/**
 * Structural check for a saved run's mod effects. It deliberately tolerates facility and program
 * names this build does not know, so retiring catalog entries never strands a modded save; the
 * authoring schema is enforced only when a package is imported.
 */
export function validScenarioMod(value: unknown): value is ScenarioModType {
  if (!plain(value)) return false;
  const { source, facilities, programs, notifications } = value;
  if (
    !plain(source) ||
    !string(source.id) ||
    !string(source.title) ||
    !string(source.creator) ||
    !string(source.version) ||
    (source.workshopId !== undefined && !string(source.workshopId))
  )
    return false;
  if (
    facilities !== undefined &&
    (!plain(facilities) ||
      !Object.values(facilities).every(
        (modifier) =>
          plain(modifier) &&
          factor(modifier.buildCost) &&
          factor(modifier.annualOperatingCost) &&
          factor(modifier.yearsToBuild),
      ))
  )
    return false;
  if (
    programs !== undefined &&
    (!plain(programs) || !Object.values(programs).every(factor))
  )
    return false;
  return (
    notifications === undefined ||
    (Array.isArray(notifications) &&
      notifications.every(
        (notice) =>
          plain(notice) &&
          Number.isSafeInteger(notice.month) &&
          string(notice.title) &&
          string(notice.message),
      ))
  );
}

/** The custom game setup a modded scenario would leave behind, with no mod effects. */
export function withoutMod(scenario: ScenarioType): ScenarioType {
  if (scenario.mod === undefined) return scenario;
  const { mod: _mod, ...setup } = scenario;
  return setup;
}
