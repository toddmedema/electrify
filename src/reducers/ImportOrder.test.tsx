/**
 * The reducers used to form an import cycle: Card needed Game's action creators while its own
 * slice was being built, and Game reached back to Store (which builds Card) and to Scenarios
 * (which imports Card). Whichever of those modules an entry point happened to load first decided
 * whether the store assembled or blew up with "Cannot read properties of undefined (reading
 * 'type')" or "No reducer provided for key card".
 *
 * Each case here loads one module in isolation as the first thing in a fresh registry, which is
 * what used to crash. They pass only while the cycle stays broken.
 */
export {}; // Every module here is loaded with require(), so this marks the file as one itself

describe("module import order", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("builds the store when the game reducer is loaded first", () => {
    const gameReducer = require("./Game").default;
    expect(typeof gameReducer).toBe("function");
    const { store } = require("../Store");
    expect(store.getState().game.inGame).toBe(false);
    expect(store.getState().card.name).toBe("MAIN_MENU");
  });

  it("builds the store when the card reducer is loaded first", () => {
    const cardReducer = require("./Card").default;
    expect(typeof cardReducer).toBe("function");
    expect(require("../Store").store.getState().card.name).toBe("MAIN_MENU");
  });

  it("builds the store when the scenarios are loaded first", () => {
    expect(require("../data/Scenarios").SCENARIOS.length).toBeGreaterThan(0);
    expect(require("../Store").store.getState().game.inGame).toBe(false);
  });

  it("builds the store when it is loaded first", () => {
    expect(require("../Store").store.getState().card.name).toBe("MAIN_MENU");
  });

  it("keeps the action types the game slice used to generate", () => {
    const { start, loaded, quit } = require("./GameActions");
    expect(start(3).type).toBe("game/start");
    expect(loaded().type).toBe("game/loaded");
    expect(quit().type).toBe("game/quit");
  });

  it("still exports those actions from the game reducer", () => {
    const game = require("./Game");
    expect(game.start(3).type).toBe("game/start");
    expect(game.loaded().type).toBe("game/loaded");
    expect(game.quit().type).toBe("game/quit");
  });

  it("routes start, loaded and quit through the game slice", () => {
    const gameReducer = require("./Game").default;
    const { start, loaded, quit } = require("./GameActions");
    const started = gameReducer(undefined, start(103));
    expect(started.scenarioId).toBe(103);
    expect(gameReducer(started, loaded()).inGame).toBe(true);
    expect(gameReducer(started, quit()).scenarioId).toBe(0);
  });

  it("still switches the card to LOADING on start and FACILITIES on loaded", () => {
    const cardReducer = require("./Card").default;
    const { start, loaded } = require("./GameActions");
    expect(cardReducer(undefined, start(0)).name).toBe("LOADING");
    expect(cardReducer(undefined, loaded()).name).toBe("FACILITIES");
  });
});
