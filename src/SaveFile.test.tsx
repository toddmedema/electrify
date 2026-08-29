import { LOCATIONS } from "./Constants";
import { CUSTOM_SCENARIO_ID } from "./data/Scenarios";
import {
  describeSave,
  downloadSave,
  MAX_SAVE_FILE_BYTES,
  readSaveFile,
  resumableSave,
  saveFilename,
} from "./SaveFile";
import { clearSave, SAVE_VERSION, serializeSave, writeSave } from "./SaveGame";
import { GameType } from "./Types";

// Enough of a game slice to be a valid save: parseSave checks the fields the simulation would
// crash on, not the whole of GameType, and building a real game here would cost a minute of setup
function fakeGame(overrides: Partial<GameType> = {}): GameType {
  return {
    scenarioId: 101, // Rise of Renewables
    seed: 31337,
    startingYear: 2020,
    customerMarketSize: 2_000_000,
    customerRate: 0.07,
    location: LOCATIONS.PIT,
    date: { minute: 1000, year: 2035, month: 6 },
    facilities: [],
    timeline: [],
    monthlyHistory: [],
    eventLog: [],
    reportedEventKeys: [],
    eventLogReadThroughId: 0,
    worldEvents: { active: [], checkedKeys: [] },
    ...overrides,
  } as unknown as GameType;
}

function saveFile(contents: unknown, name = "save.json"): File {
  const text =
    typeof contents === "string" ? contents : JSON.stringify(contents);
  return new File([text], name, { type: "application/json" });
}

describe("SaveFile", () => {
  beforeEach(() => {
    clearSave();
  });

  describe("resumableSave", () => {
    it("is nothing when no game has been saved", () => {
      expect(resumableSave()).toBeNull();
    });

    it("resolves the scenario the save was played in", () => {
      writeSave(fakeGame());
      expect(describeSave(resumableSave()!)).toBe("Rise of Renewables, 2035");
    });

    it("ignores a save whose scenario this build no longer has", () => {
      writeSave(fakeGame({ scenarioId: 99999 }));
      expect(resumableSave()).toBeNull();
    });

    it("takes a custom game's scenario from the save itself", () => {
      writeSave(
        fakeGame({
          scenarioId: CUSTOM_SCENARIO_ID,
          customScenario: { id: CUSTOM_SCENARIO_ID, name: "My Grid" } as never,
        }),
      );
      expect(describeSave(resumableSave()!)).toBe("My Grid, 2035");
    });
  });

  describe("saveFilename", () => {
    it("slugs the scenario name", () => {
      expect(saveFilename("Rise of Renewables", 2035)).toBe(
        "electrify-rise-of-renewables-2035.json",
      );
    });

    // A custom game's name is typed by the player, so it reaches here as anything at all
    it("folds away everything a filename shouldn't carry", () => {
      expect(saveFilename("../../etc/passwd", 2020)).toBe(
        "electrify-etc-passwd-2020.json",
      );
      expect(saveFilename("!!!", 2020)).toBe("electrify-game-2020.json");
    });
  });

  describe("downloadSave", () => {
    let clicked: HTMLAnchorElement | undefined;
    let revoked: string[] = [];

    beforeEach(() => {
      jest.useFakeTimers();
      clicked = undefined;
      revoked = [];
      URL.createObjectURL = jest.fn(() => "blob:save");
      URL.revokeObjectURL = jest.fn((url: string) => revoked.push(url));
      jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(function (this: HTMLAnchorElement) {
          clicked = this;
          // The anchor has to be in the document at the moment of the click for Firefox
          expect(this.isConnected).toBe(true);
        });
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it("downloads the save under the scenario's name", () => {
      writeSave(fakeGame());
      downloadSave(resumableSave()!);

      expect(clicked?.download).toBe("electrify-rise-of-renewables-2035.json");
      expect(clicked?.href).toBe("blob:save");
      // Left where it was found, and the object URL released once the download has started
      expect(clicked?.isConnected).toBe(false);
      expect(revoked).toEqual([]);
      jest.runOnlyPendingTimers();
      expect(revoked).toEqual(["blob:save"]);
    });
  });

  describe("readSaveFile", () => {
    it("accepts a save this build can play", async () => {
      const game = fakeGame();
      const { save, error } = await readSaveFile(saveFile(serializeSave(game)));
      expect(error).toBeUndefined();
      expect(save?.game.seed).toBe(game.seed);
    });

    it("round trips an exported save", async () => {
      writeSave(fakeGame());
      const exported = resumableSave()!.save;
      const { save } = await readSaveFile(saveFile(exported));
      expect(save).toEqual(exported);
    });

    it("rejects a file that isn't JSON", async () => {
      const { save, error } = await readSaveFile(saveFile("not json {"));
      expect(save).toBeUndefined();
      expect(error).toMatch(/isn't an Electrify save/);
    });

    it("rejects an incompatible save", async () => {
      const { save, error } = await readSaveFile(
        saveFile({ ...serializeSave(fakeGame()), version: SAVE_VERSION + 1 }),
      );
      expect(save).toBeUndefined();
      expect(error).toMatch(/newer simulation version/);
    });

    it("explains that an older simulation save cannot be migrated", async () => {
      const { save, error } = await readSaveFile(
        saveFile({ ...serializeSave(fakeGame()), version: SAVE_VERSION - 1 }),
      );
      expect(save).toBeUndefined();
      expect(error).toMatch(/created by an older simulation version/);
    });

    it("rejects a save whose scenario this build doesn't have", async () => {
      const { save, error } = await readSaveFile(
        saveFile(serializeSave(fakeGame({ scenarioId: 99999 }))),
      );
      expect(save).toBeUndefined();
      expect(error).toMatch(/scenario/);
    });

    // Whatever the player picked, it's read into memory before anything else looks at it
    it("rejects a file too big to be a save", async () => {
      const file = saveFile(serializeSave(fakeGame()));
      Object.defineProperty(file, "size", {
        value: MAX_SAVE_FILE_BYTES + 1,
      });
      const { save, error } = await readSaveFile(file);
      expect(save).toBeUndefined();
      expect(error).toMatch(/too big/);
    });
  });
});
