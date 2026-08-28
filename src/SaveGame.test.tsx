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
  startAutosave,
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

  // The location is checked in full rather than just for being an object, the same way a replay's
  // is: its id becomes the path of the weather file the loading screen fetches, and the rest of it
  // drives the sun model
  it("ignores a save whose location isn't one", () => {
    const save = serializeSave(game);
    const withLocation = (location: unknown) =>
      parseSave({ ...save, game: { ...save.game, location } });
    expect(withLocation(undefined)).toBeNull();
    expect(withLocation({})).toBeNull();
    // Straight into `/data/weather/<id>[.v2].bin`
    expect(
      withLocation({ ...save.game.location, id: "../../secrets" }),
    ).toBeNull();
    // Off the globe, which the sun model has no answer for
    expect(withLocation({ ...save.game.location, lat: 400 })).toBeNull();
    expect(withLocation({ ...save.game.location, long: "west" })).toBeNull();
    // Arbitrary coordinates legitimately have no IANA zone; their longitude supplies an offset.
    expect(
      withLocation({ ...save.game.location, timeZone: undefined }),
    ).not.toBeNull();
    expect(withLocation({ ...save.game.location, timeZone: 5 })).toBeNull();
    // And the real one still round trips
    expect(parseSave(save)).not.toBeNull();
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

  describe("autosave", () => {
    // Enough of a store for the subscriber: state it can read, and a way to notify
    function fakeStore(initial: GameType) {
      const listeners: Array<() => void> = [];
      const self = {
        state: initial,
        dispatched: [] as unknown[],
        getState: () => ({ game: self.state }),
        subscribe: (fn: () => void) => {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
        dispatch: (a: unknown) => self.dispatched.push(a),
        // Sets the slice the way a reducer would, then notifies like Redux does
        set: (next: GameType) => {
          self.state = next;
          listeners.forEach((fn) => fn());
        },
      };
      return self;
    }

    // A game running at a given point in a given year
    function playing(base: GameType, year: number, minute: number): GameType {
      return { ...base, inGame: true, date: { ...base.date, year, minute } };
    }

    // What quit leaves behind
    const quit = { ...game, inGame: false };

    it("writes as soon as a game starts", () => {
      const store = fakeStore(quit);
      const stop = startAutosave(store as never, () => true);

      store.set(playing(game, 2020, 0));
      expect(readSave()!.game.date.year).toBe(2020);

      stop();
    });

    it("writes once a year, at the turn of the year", () => {
      const store = fakeStore(quit);
      const stop = startAutosave(store as never, () => true);

      store.set(playing(game, 2020, 0));
      // Mid-year progress isn't written on its own
      store.set(playing(game, 2020, 100));
      store.set(playing(game, 2020, 200));
      expect(readSave()!.game.date.minute).toBe(0);

      // ...until the year turns, which is never skipped, throttled or collapsed
      store.set(playing(game, 2021, 300));
      expect(readSave()!.game.date.minute).toBe(300);
      store.set(playing(game, 2022, 400));
      expect(readSave()!.game.date.minute).toBe(400);

      stop();
    });

    /**
     * The bug this guards: quitting from the in-game menu fires none of the page lifecycle events,
     * and quit resets the slice before the subscriber sees it, so a player who quit partway
     * through a year came back to the start of it.
     */
    it("flushes the part-year when the player quits to the menu", () => {
      const store = fakeStore(quit);
      const stop = startAutosave(store as never, () => true);

      store.set(playing(game, 2020, 0));
      store.set(playing(game, 2020, 5000));
      expect(readSave()!.game.date.minute).toBe(0);

      store.set(quit);
      expect(readSave()!.game.date.minute).toBe(5000);

      stop();
    });

    // Bankrupt and fired clear the save and then quit, and the flush must not undo that
    it("doesn't resurrect a save the scenario ending cleared", () => {
      const store = fakeStore(quit);
      const stop = startAutosave(store as never, () => true);

      store.set(playing(game, 2020, 0));
      store.set(playing(game, 2020, 5000));
      clearSave();

      store.set(quit);
      expect(readSave()).toBeNull();

      stop();
    });

    it("leaves tutorials alone", () => {
      const store = fakeStore(quit);
      const stop = startAutosave(store as never, () => false);

      store.set(playing(game, 2020, 0));
      store.set(quit);
      expect(readSave()).toBeNull();

      stop();
    });

    it("stops writing once torn down", () => {
      const store = fakeStore(quit);
      startAutosave(store as never, () => true)();

      store.set(playing(game, 2020, 0));
      expect(readSave()).toBeNull();
    });
  });

  it("recognizes a restored slice by its timeline", () => {
    expect(isResumedGame(game)).toBe(true);
    expect(isResumedGame({ ...game, timeline: [] })).toBe(false);
  });
});
