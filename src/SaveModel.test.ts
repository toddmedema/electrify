import {
  normalizeSaveName,
  parseSavedRunResult,
  savedRunResult,
  selectContinueSave,
  sortSaves,
  suggestedSaveName,
  validateSaveFileEnvelope,
} from "./SaveModel";
import { parseSave } from "./SaveGame";
import { fakeSaveFile, fakeSavedResult } from "./testing/SaveTestHelpers";
import { captureRunIdentity } from "./helpers/RunIdentity";
import { getScenario } from "./data/Scenarios";
import { encodeSaveFile } from "./SaveFile";
import type { SaveMetadata, VictoryType } from "./Types";

function summary(
  id: string,
  lastPlayedAt?: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): SaveMetadata {
  return {
    id,
    name: id,
    createdAt,
    lastPlayedAt,
    savedAt: "2026-02-01T00:00:00.000Z",
    revision: 1,
    status: "inProgress",
    scenarioId: 101,
    scenarioName: "Rise of Renewables",
    locationName: "Pittsburgh",
    difficulty: "Employee",
    date: { month: "Jun", year: 2035 },
  };
}

describe("SaveModel", () => {
  it("upgrades an older encoded run without mutating the original", () => {
    const file = fakeSaveFile();
    file.save.game.runIdentity = captureRunIdentity(
      getScenario(101)!,
      31337,
      "Employee",
    );
    file.save.game.location = file.save.game.runIdentity.inputs.location;
    const raw = encodeSaveFile(file);
    raw.save.game.runIdentity!.compatibilityId = `rules-1-${"0".repeat(64)}`;
    raw.save.rulesId = raw.save.game.runIdentity!.compatibilityId;
    const original = JSON.stringify(raw);
    const upgraded = validateSaveFileEnvelope(raw, parseSave);
    expect(upgraded.save.game.runIdentity).toBeUndefined();
    expect(upgraded.save.game.upgradedFromRules).toBe(
      raw.save.game.runIdentity!.compatibilityId,
    );
    expect(upgraded.save.game.facilities).toEqual(raw.save.game.facilities);
    expect(JSON.stringify(raw)).toBe(original);
    raw.save.game.customerRate = NaN;
    expect(() => validateSaveFileEnvelope(raw, parseSave)).toThrow(
      /isn't a valid/,
    );
  });

  it("explains a save schema from a newer app without attempting a downgrade", () => {
    const raw = encodeSaveFile(fakeSaveFile());
    raw.save.schemaVersion = 999;
    expect(() => validateSaveFileEnvelope(raw, parseSave)).toThrow(
      /newer version/,
    );
  });

  it("keeps result and current-build identity failures invalid", () => {
    const file = fakeSaveFile();
    file.save.game.runIdentity = captureRunIdentity(
      getScenario(101)!,
      31337,
      "Employee",
    );
    file.save.game.location = file.save.game.runIdentity.inputs.location;
    expect(
      validateSaveFileEnvelope(file, parseSave).save.game.runIdentity,
    ).toEqual(file.save.game.runIdentity);
    file.save.game.runIdentity.seed++;
    expect(() => validateSaveFileEnvelope(file, parseSave)).toThrow(
      /isn't a valid/,
    );
    file.save.game.runIdentity.compatibilityId = `rules-1-${"0".repeat(64)}`;
    file.status = "completed";
    expect(() => validateSaveFileEnvelope(file, parseSave)).toThrow(
      /isn't a valid/,
    );
    file.result = fakeSavedResult({ scenarioId: 102 });
    expect(() => validateSaveFileEnvelope(file, parseSave)).toThrow(
      /isn't a valid/,
    );
  });

  it("trims names and counts Unicode code points consistently", () => {
    expect(normalizeSaveName("  🌱 My grid  ")).toBe("🌱 My grid");
    expect(normalizeSaveName("🌱".repeat(60))).toHaveLength(120);
    expect(() => normalizeSaveName("🌱".repeat(61))).toThrow(/60/);
    ["", "   ", "one\ntwo", "\u0000name", "name\u2028next"].forEach((name) =>
      expect(() => normalizeSaveName(name)).toThrow(),
    );
  });

  it("generates distinct bounded names even with long source labels", () => {
    const base = suggestedSaveName("🌱".repeat(70), "Somewhere", []);
    expect(Array.from(base)).toHaveLength(60);
    const second = suggestedSaveName("🌱".repeat(70), "Somewhere", [base]);
    expect(second).toMatch(/\(2\)$/);
    expect(Array.from(second)).toHaveLength(60);
    expect(
      suggestedSaveName("Grid", "City", ["Grid — City", "Grid — City (2)"]),
    ).toBe("Grid — City (3)");
  });

  it("derives Continue from actual play, with deterministic ties and import fallback", () => {
    const played = summary("b", "2026-01-02T00:00:00.000Z");
    const imported = summary("z", undefined, "2026-04-01T00:00:00.000Z");
    expect(selectContinueSave([imported, played])?.id).toBe("b");
    expect(selectContinueSave([played, { ...played, id: "a" }])?.id).toBe("a");
    expect(
      selectContinueSave([imported, { ...played, status: "bankrupt" }])?.id,
    ).toBe("z");
    expect(selectContinueSave([imported, summary("a")])?.id).toBe("z");
    expect(selectContinueSave([])).toBeUndefined();
    expect(
      sortSaves([
        played,
        {
          ...played,
          id: "a",
          name: "Renamed",
          savedAt: "2026-05-01T00:00:00.000Z",
        },
      ]).map(({ id }) => id),
    ).toEqual(["a", "b"]);
  });

  it("selects presentation-only result fields and never retains leaderboard authority", () => {
    const result = savedRunResult({
      ...fakeSavedResult(),
      ranked: true,
      previousBest: 400,
    } as VictoryType);
    expect(result).toEqual(fakeSavedResult());
    expect(result).not.toHaveProperty("ranked");
    expect(result).not.toHaveProperty("previousBest");
    expect(parseSavedRunResult({ ...result, score: Infinity })).toBeNull();
    expect(
      parseSavedRunResult({ ...result, breakdown: { alien: 3 } }),
    ).toBeNull();
    expect(
      parseSavedRunResult({ ...result, debrief: { startingFleet: [] } }),
    ).toBeNull();
  });

  it("requires the status, result and payload identity to agree", () => {
    expect(validateSaveFileEnvelope(fakeSaveFile(), parseSave).status).toBe(
      "inProgress",
    );
    expect(() =>
      validateSaveFileEnvelope(
        fakeSaveFile({ status: "completed" }),
        parseSave,
      ),
    ).toThrow(/valid/);
    expect(() =>
      validateSaveFileEnvelope(
        fakeSaveFile({ result: fakeSavedResult() }),
        parseSave,
      ),
    ).toThrow(/valid/);
    expect(() =>
      validateSaveFileEnvelope(
        fakeSaveFile({
          status: "completed",
          result: fakeSavedResult({ scenarioId: 102 }),
        }),
        parseSave,
      ),
    ).toThrow(/valid/);
    expect(() =>
      validateSaveFileEnvelope(
        fakeSaveFile({ status: "fired", result: fakeSavedResult() }),
        parseSave,
      ),
    ).toThrow(/valid/);
    expect(
      validateSaveFileEnvelope(
        fakeSaveFile({ status: "completed", result: fakeSavedResult() }),
        parseSave,
      ).result,
    ).toEqual(fakeSavedResult());
  });

  it("rejects the old envelope and strips local identity from the current one", () => {
    expect(() =>
      validateSaveFileEnvelope(fakeSaveFile().save, parseSave),
    ).toThrow(/unsupported/);
    const parsed = validateSaveFileEnvelope(
      {
        ...fakeSaveFile(),
        id: "foreign",
        revision: 12,
        writerToken: "foreign",
      },
      parseSave,
    );
    expect(parsed).not.toHaveProperty("id");
    expect(parsed).not.toHaveProperty("revision");
  });
});
