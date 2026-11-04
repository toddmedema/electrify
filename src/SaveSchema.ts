import { SAVE_SCHEMA_VERSION } from "./SaveUpgrade";

export { SAVE_SCHEMA_VERSION } from "./SaveUpgrade";

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
