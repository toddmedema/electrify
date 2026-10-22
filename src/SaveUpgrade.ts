import { validWorldEvent } from "./helpers/WorldEventValidation";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// Each step receives a decoded save of the previous schema and returns the next structure.
// Append a step for every structural change; never edit an existing step.
const migrations: ((
  save: Record<string, unknown>,
) => Record<string, unknown>)[] = [
  // 0 -> 1: unversioned saves already have the current structure.
  (save) => save,
  // 1 -> 2: Electron adds optional per-run achievement telemetry. Existing saves
  // start observing on their next committed tick, without inventing historical counters.
  // At this schema's rollout web imports discarded telemetry; both editions now validate it.
  process.env.REACT_APP_DESKTOP === "true"
    ? (save) => ({
        ...save,
        ...(object(save.game) && {
          game: { ...save.game, desktopAchievements: undefined },
        }),
      })
    : (save) => save,
  // 2 -> 3: existing programs retain their progress; new flexibility offers start off.
  (save) => {
    if (!object(save.game) || !object(save.game.policies)) return save;
    const policies = save.game.policies;
    if (!object(policies.programs)) return save;
    const programs = { ...policies.programs };
    for (const id of ["thermal", "evCharging", "battery"])
      if (!(id in programs))
        programs[id] = {
          tier: "Off",
          adoption: 0,
          spending: 0,
          spent: 0,
          installs: [],
        };
    return {
      ...save,
      game: { ...save.game, policies: { ...policies, programs } },
    };
  },
  // 3 -> 4: retire the old wildfire plant lottery prospectively. Historical occurrences and
  // booked results remain evidence of the rules that produced them; active copies suppress
  // rerolling the same authored phase until its original end.
  (save) => {
    if (!object(save.game)) return save;
    const game = save.game;
    if (!object(game.worldEvents)) return save;
    const worldEvents = game.worldEvents;
    if (!Array.isArray(worldEvents.active) || !object(game.date)) return save;
    const minute = game.date.minute;
    if (typeof minute !== "number" || !Number.isFinite(minute)) return save;
    let retired = false;
    const active = worldEvents.active.map((event) => {
      if (
        !object(event) ||
        !validWorldEvent(event) ||
        !object(event.attributes) ||
        typeof event.endsMinute !== "number" ||
        event.endsMinute <= minute ||
        !(
          event.definitionId === "recurring-wildfire" ||
          (event.definitionId === "california-wildfire-2025:firestorm" &&
            ("outputMultiplier" in event.attributes ||
              "selectedFacilityIds" in event.attributes))
        )
      )
        return event;
      retired = true;
      return {
        ...event,
        effects: {},
        message:
          "Earlier wildfire impacts remain in recorded history. No further generator restrictions or restoration charges apply to this event.",
      };
    });
    if (!retired) return save;
    return {
      ...save,
      game: {
        ...game,
        wildfireForecastRefresh: true,
        worldEvents: { ...worldEvents, active },
      },
    };
  },
  // 4 -> 5: remove retired smoke, service-interruption and backup effects. Keep all
  // recorded accounts, actions and results; refresh only ticks after the saved instant.
  (save) => {
    if (!object(save.game)) return save;
    const game = save.game;
    if (!object(game.worldEvents)) return save;
    const events = game.worldEvents;
    if (!Array.isArray(events.active) || !Array.isArray(events.occurrences))
      return save;
    const retired = (event: unknown) =>
      object(event) &&
      (event.definitionId === "recurring-wildfire" ||
        event.definitionId === "wildfire-smoke" ||
        (typeof event.definitionId === "string" &&
          event.definitionId.startsWith("california-wildfire-2025:")) ||
        (typeof event.key === "string" && event.key.startsWith("wildfire:")));
    const hadRetired = [...events.active, ...events.occurrences].some(retired);
    const removedSelection =
      object(game.customScenario) &&
      Array.isArray(game.customScenario.eventScenarioIds) &&
      game.customScenario.eventScenarioIds.includes(111);
    const legacyLines =
      game.scenarioId === 111 &&
      object(game.transmission) &&
      Array.isArray(game.transmission.lines) &&
      game.transmission.lines.some(
        (line) =>
          object(line) &&
          ((line.corridorId === "california-north" &&
            typeof line.capacityW === "number" &&
            line.capacityW < 40e6) ||
            (line.corridorId === "california-south" &&
              [7.5e6, 11.25e6, 16.875e6, 25.3125e6].includes(
                line.capacityW as number,
              ))),
      );
    const occurrences = events.occurrences.map((event) => {
      if (!retired(event) || !object(event) || !object(event.effects))
        return event;
      const effects = { ...event.effects };
      for (const key of [
        "solarIrradianceMultiplier",
        "solarIrradianceMultipliersByHour",
        "serviceInterruptionFraction",
        "localBackupWhPerMonth",
      ])
        delete effects[key];
      return { ...event, effects };
    });
    const customScenario =
      object(game.customScenario) &&
      Array.isArray(game.customScenario.eventScenarioIds)
        ? {
            ...game.customScenario,
            eventScenarioIds: game.customScenario.eventScenarioIds.filter(
              (id) => id !== 111,
            ),
          }
        : game.customScenario;
    return {
      ...save,
      game: {
        ...game,
        customScenario,
        ...(hadRetired || removedSelection || game.scenarioId === 111
          ? { wildfireForecastRefresh: true }
          : {}),
        ...(legacyLines || (game.scenarioId === 111 && object(game.multiplayer))
          ? { legacyWildfireIntertieAccess: true }
          : {}),
        worldEvents: {
          ...events,
          active: events.active.filter((event) => !retired(event)),
          occurrences,
        },
      },
    };
  },
];

/** Save structure evolves independently of simulation rules and app releases. */
export const SAVE_SCHEMA_VERSION = migrations.length;

function schemaVersion(raw: Record<string, unknown>): number | undefined {
  const version = raw.schemaVersion === undefined ? 0 : raw.schemaVersion;
  return typeof version === "number" &&
    Number.isInteger(version) &&
    version >= 0
    ? version
    : undefined;
}

/** A well-formed save written by a newer app, which this one must not guess at. */
export function isFutureSave(raw: unknown): boolean {
  if (!object(raw)) return false;
  const version = schemaVersion(raw);
  return version !== undefined && version > SAVE_SCHEMA_VERSION;
}

/** Upgrade a decoded save to the current schema, as a copy; the caller validates the result. */
export function upgradeSave(raw: unknown): Record<string, unknown> | null {
  if (!object(raw)) return null;
  const version = schemaVersion(raw);
  if (version === undefined || version > SAVE_SCHEMA_VERSION) return null;
  let save = raw;
  for (let step = version; step < SAVE_SCHEMA_VERSION; step++)
    save = { ...migrations[step](save), schemaVersion: step + 1 };
  return save;
}
