/** Rules recorded by saves that predate rules fingerprints; never the running rules. */
export const LEGACY_RULES_ID = "legacy";
const RULES_ID = /^rules-\d+-[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function isRulesId(value: unknown): value is string {
  return (
    value === LEGACY_RULES_ID ||
    (typeof value === "string" && RULES_ID.test(value))
  );
}

// Each step receives a decoded save of the previous schema and returns the next structure.
// Append a step for every structural change; never edit an existing step.
const migrations: ((
  save: Record<string, unknown>,
) => Record<string, unknown>)[] = [
  // 0 -> 1: record the rules each save was written under. Unversioned saves already
  // have the current structure; only a shareable run identity names their rules.
  (save) => {
    const game = object(save.game) ? save.game : {};
    const identity = object(game.runIdentity) ? game.runIdentity : {};
    return {
      ...save,
      rulesId:
        identity.compatibilityId === undefined
          ? LEGACY_RULES_ID
          : identity.compatibilityId,
    };
  },
];

/** Save structure evolves independently of challenge/replay rules and app releases. */
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

/**
 * Upgrade a decoded save to the current schema, as a copy. The caller still validates the
 * entire result, and decides what an older rules fingerprint means for the run.
 */
export function upgradeSave(raw: unknown): Record<string, unknown> | null {
  if (!object(raw)) return null;
  const version = schemaVersion(raw);
  if (version === undefined || version > SAVE_SCHEMA_VERSION) return null;
  let save = raw;
  for (let step = version; step < SAVE_SCHEMA_VERSION; step++)
    save = { ...migrations[step](save), schemaVersion: step + 1 };
  return save;
}
