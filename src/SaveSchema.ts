/** Current save structure. Other schemas are rejected rather than migrated. */
export const SAVE_SCHEMA_VERSION = 6;

export function isFutureSave(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  return (
    typeof version === "number" &&
    Number.isInteger(version) &&
    version >= 0 &&
    version > SAVE_SCHEMA_VERSION
  );
}
