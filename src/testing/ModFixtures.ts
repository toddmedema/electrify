import type { ModPackage } from "../mods/ModSchema";

/** A minimal valid community package; tests override only what they exercise. */
export const modPackage = (patch: Partial<ModPackage> = {}): ModPackage => ({
  schemaVersion: 1,
  gameApi: 1,
  id: "fixture-grid",
  title: "Fixture grid",
  creator: "Fixture",
  version: "1",
  description: "A fixture grid.",
  seed: 42,
  baseScenarioId: 999,
  ...patch,
});
