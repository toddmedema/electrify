import { validateMod } from "../mods/ModSchema";
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
  const modifier =
    game.customScenario?.mod?.facilities?.[name as ModFacilityNameType];
  if (modifier && !Object.values(modifier).every(factor))
    throw new Error(
      `Invalid mod facility modifier for ${name}: factors must be from 0.1 to 10.`,
    );
  return modifier;
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
  (typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0.1 &&
    value <= 10);

/** Reject bad factors/results before their caller can commit a transaction or quote. */
export function modScaledValue(
  value: number,
  multiplier: number | undefined,
  path: string,
): number {
  if (!factor(multiplier))
    throw new Error(`${path} must be a factor from 0.1 to 10.`);
  const result = value * (multiplier ?? 1);
  if (!Number.isFinite(result))
    throw new Error(`${path} produces a nonfinite result.`);
  return result;
}

/** First-release snapshots enforce the same catalog, text, count and factor limits as packages. */
export function validScenarioMod(value: unknown): value is ScenarioModType {
  if (
    !plain(value) ||
    Object.keys(value).some(
      (key) =>
        !["source", "facilities", "programs", "notifications"].includes(key),
    )
  )
    return false;
  const { source, facilities, programs, notifications } = value;
  if (
    !plain(source) ||
    Object.keys(source).some(
      (key) =>
        !["id", "title", "creator", "version", "workshopId"].includes(key),
    )
  )
    return false;
  if (
    source.workshopId !== undefined &&
    (typeof source.workshopId !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(source.workshopId))
  )
    return false;
  try {
    validateMod({
      schemaVersion: 1,
      gameApi: 1,
      id: source.id,
      title: source.title,
      creator: source.creator,
      version: source.version,
      seed: 0,
      baseScenarioId: 999,
      ...(facilities === undefined ? {} : { facilities }),
      ...(programs === undefined ? {} : { programs }),
      ...(notifications === undefined ? {} : { notifications }),
    });
    return true;
  } catch {
    return false;
  }
}

/** The custom game setup a modded scenario would leave behind, with no mod effects. */
export function withoutMod(scenario: ScenarioType): ScenarioType {
  if (scenario.mod === undefined) return scenario;
  const { mod: _mod, ...setup } = scenario;
  return setup;
}
