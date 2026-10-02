import { LOCATIONS } from "./Constants";
import { CUSTOM_SCENARIO_ID, DEFAULT_CUSTOM_SCENARIO } from "./data/Scenarios";
import {
  downloadSave,
  downloadSaveRecovery,
  encodeSaveFile,
  MAX_SAVE_FILE_BYTES,
  readSaveFile,
  saveFilename,
} from "./SaveFile";
import { serializeSave } from "./SaveGame";
import {
  fakeSaveFile,
  fakeSaveGame,
  fakeSavedResult,
} from "./testing/SaveTestHelpers";
import type { ScenarioType } from "./Types";

function saveFile(contents: unknown): File {
  return new File(
    [typeof contents === "string" ? contents : JSON.stringify(contents)],
    "save.json",
    { type: "application/json" },
  );
}

describe("SaveFile", () => {
  it("uses a sanitized player name for filenames", () => {
    expect(saveFilename("../../etc/passwd", 2020)).toBe(
      "electrify-etc-passwd-2020.json",
    );
    expect(saveFilename("!!!", 2020)).toBe("electrify-game-2020.json");
    expect(saveFilename("My renamed game", 2035)).toBe(
      "electrify-my-renamed-game-2035.json",
    );
  });

  describe("downloadSave", () => {
    let clicked: HTMLAnchorElement | undefined;
    const revoked: string[] = [];
    beforeEach(() => {
      jest.useFakeTimers();
      clicked = undefined;
      revoked.length = 0;
      URL.createObjectURL = jest.fn(() => "blob:save");
      URL.revokeObjectURL = jest.fn((url: string) => revoked.push(url));
      jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          clicked = this;
          expect(this.isConnected).toBe(true);
        });
    });
    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      jest.restoreAllMocks();
    });
    it("downloads the named envelope and releases its temporary DOM resources", () => {
      downloadSave(fakeSaveFile());
      expect(clicked?.download).toBe(
        "electrify-renewables-experiment-2035.json",
      );
      expect(clicked?.href).toBe("blob:save");
      expect(clicked?.isConnected).toBe(false);
      expect(revoked).toEqual([]);
      jest.runOnlyPendingTimers();
      expect(revoked).toEqual(["blob:save"]);
    });
    it("downloads malformed raw data under a recovery filename without playable-save validation", async () => {
      const raw = {
        metadata: { id: "save-one" },
        payload: { save: { broken: "original data" } },
      };
      downloadSaveRecovery("../SAVE one", raw);
      expect(clicked?.download).toBe("electrify-recovery-save-one.json");
      const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
      const contents = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
      expect(JSON.parse(contents)).toEqual(raw);
      expect(clicked?.isConnected).toBe(false);
    });
  });

  describe("readSaveFile", () => {
    it("round trips the packed current envelope", async () => {
      const exported = fakeSaveFile();
      expect(encodeSaveFile(exported).save.game.timeline).toHaveProperty(
        "shapes",
      );
      expect(await readSaveFile(saveFile(encodeSaveFile(exported)))).toEqual({
        file: exported,
      });
    });
    it("round trips completed and terminal results without account metadata", async () => {
      for (const outcome of ["completed", "bankrupt", "fired"] as const) {
        const exported = fakeSaveFile({
          status: outcome,
          result: fakeSavedResult({ outcome }),
        });
        expect(
          (await readSaveFile(saveFile(encodeSaveFile(exported)))).file,
        ).toEqual(exported);
      }
    });
    it("round trips every custom setup choice", async () => {
      const customScenario: ScenarioType = {
        ...DEFAULT_CUSTOM_SCENARIO,
        locationId: LOCATIONS.HNL.id,
        location: LOCATIONS.HNL,
        ownership: "Public",
        startingYear: 2080,
        cash: 1_700_000_000,
        startingCustomers: 2_350_000,
        dollarsPerkWh: 0.42,
        durationMonths: 60 * 12,
        feePerKgCO2e: 0.31,
        seed: 8675309,
        facilities: [
          { name: "Offshore Wind", peakW: 500_000_000 },
          { name: "Battery", peakWh: 1_000_000_000 },
        ],
      };
      const exported = fakeSaveFile({
        save: serializeSave(
          fakeSaveGame({
            scenarioId: CUSTOM_SCENARIO_ID,
            customScenario,
            location: customScenario.location!,
            startingYear: customScenario.startingYear,
            seed: customScenario.seed!,
            difficulty: "CEO",
          }),
        ),
      });
      const { file, error } = await readSaveFile(
        saveFile(encodeSaveFile(exported)),
      );
      expect(error).toBeUndefined();
      expect(file?.save.game.difficulty).toBe("CEO");
      expect(file?.save.game.customScenario).toEqual(customScenario);
    });
    it("rejects non-JSON, oversized files, and unsupported previous envelopes", async () => {
      expect((await readSaveFile(saveFile("not json {"))).error).toMatch(
        /isn't an Electrify save/,
      );
      const oversized = saveFile(fakeSaveFile());
      Object.defineProperty(oversized, "size", {
        value: MAX_SAVE_FILE_BYTES + 1,
      });
      expect((await readSaveFile(oversized)).error).toMatch(/too large/);
      expect((await readSaveFile(saveFile(fakeSaveFile().save))).error).toMatch(
        /unsupported save format/,
      );
    });
    it("rejects malformed nested payload, name and status-result relationships", async () => {
      for (const invalid of [
        { ...fakeSaveFile(), name: "Line\nbreak" },
        { ...fakeSaveFile(), save: {} },
        { ...fakeSaveFile(), status: "completed" },
        {
          ...fakeSaveFile(),
          status: "completed",
          result: fakeSavedResult({ score: Infinity }),
        },
      ]) {
        const imported = await readSaveFile(saveFile(invalid));
        expect(imported.file).toBeUndefined();
        expect(imported.error).toBeDefined();
      }
    });
  });
});
