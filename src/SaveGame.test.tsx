import { getTimeFromTimeline } from "./helpers/DateTime";
import {
  clearSave,
  clearSaveFor,
  isResumedGame,
  parseSave,
  readSave,
  SAVE_KEY,
  SAVE_VERSION,
  serializeSave,
  writeSave,
} from "./SaveGame";
import { createGame } from "./testing/Simulator";
import { GameType } from "./Types";

jest.setTimeout(60000);

// Rise of Renewables, entirely inside the recorded data so setup stays quick
const OPTIONS = { scenarioId: 101, seed: 31337 };

function cash(game: GameType): number {
  return getTimeFromTimeline(game.date.minute, game.timeline)!.cash;
}

describe("SaveGame", () => {
  let game: GameType;

  beforeAll(() => {
    game = createGame(OPTIONS);
  });

  beforeEach(() => {
    clearSave();
  });

  it("round trips a game through local storage", () => {
    expect(writeSave(game)).toBe(true);

    const save = readSave();
    expect(save).not.toBeNull();
    expect(save!.version).toBe(SAVE_VERSION);
    expect(save!.game.seed).toBe(game.seed);
    expect(save!.game.scenarioId).toBe(game.scenarioId);
    expect(save!.game.facilities).toEqual(game.facilities);
    expect(save!.game.monthlyHistory).toEqual(game.monthlyHistory);
    expect(cash(save!.game)).toBe(cash(game));
  });

  // The memo must never alias the live game slice, or a Continue button would describe a game
  // that has kept playing since it was saved
  it("reads back through storage rather than handing back the live object", () => {
    writeSave(game);

    const save = readSave();
    expect(save!.game).not.toBe(game);
    expect(save!.game).toEqual(JSON.parse(JSON.stringify(game)));
  });

  it("reports no save when nothing has been written", () => {
    expect(readSave()).toBeNull();
  });

  it("forgets the save it just cleared", () => {
    writeSave(game);
    expect(readSave()).not.toBeNull();
    clearSave();
    expect(readSave()).toBeNull();
  });

  it("ignores a save from a different schema version", () => {
    expect(
      parseSave({ ...serializeSave(game), version: SAVE_VERSION + 1 }),
    ).toBeNull();
  });

  it("ignores corrupt JSON", () => {
    window.localStorage.setItem(SAVE_KEY, "{not json");
    expect(readSave()).toBeNull();
  });

  it("ignores blobs that aren't saves", () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave("nope")).toBeNull();
    expect(parseSave({})).toBeNull();
    expect(parseSave({ version: SAVE_VERSION })).toBeNull();
  });

  // An imported file is untrusted input, and a malformed facility would otherwise only surface as
  // a crash mid-tick
  it("ignores a save whose game is the wrong shape", () => {
    const save = serializeSave(game);
    expect(
      parseSave({ ...save, game: { ...save.game, facilities: 3 } }),
    ).toBeNull();
    expect(
      parseSave({ ...save, game: { ...save.game, scenarioId: "101" } }),
    ).toBeNull();
    expect(
      parseSave({ ...save, game: { ...save.game, date: undefined } }),
    ).toBeNull();
    expect(
      parseSave({ ...save, game: { ...save.game, monthlyHistory: null } }),
    ).toBeNull();
  });

  // Tutorials run a single month and hit the win trigger on the way past. Clearing on any
  // scenario ending would throw away a real game the player still wanted.
  it("only clears the save belonging to the scenario that ended", () => {
    writeSave(game);
    clearSaveFor(game.scenarioId + 1);
    expect(readSave()).not.toBeNull();
    clearSaveFor(game.scenarioId);
    expect(readSave()).toBeNull();
  });

  it("recognizes a restored slice by its timeline", () => {
    expect(isResumedGame(game)).toBe(true);
    expect(isResumedGame({ ...game, timeline: [] })).toBe(false);
  });
});
