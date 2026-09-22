import gameReducer, { setSpeed } from "./Game";
import { navigate, navigateBack } from "./Card";
import { manualHelpOpen, manualHelpClose } from "./UI";
import { pageHidden, pageVisible, quit } from "./GameActions";
import { GameType } from "../Types";

// The remembered speeds live in module-level state shared by every test in this file, so a
// test that dies mid-sequence would leak its captures into the next one. quit() drops them all.
beforeEach(() => {
  gameReducer(undefined, quit());
});

function running(speed: "SLOW" | "NORMAL" | "FAST" = "FAST"): GameType {
  const state = gameReducer(undefined, setSpeed(speed));
  return { ...state, inGame: true };
}

function paused(): GameType {
  return {
    ...gameReducer(undefined, setSpeed("PAUSED")),
    inGame: true,
  };
}

describe("the backgrounded page pausing the game", () => {
  it("pauses on the way out and restores the speed on the way back", () => {
    const hidden = gameReducer(running("FAST"), pageHidden());
    expect(hidden.speed).toBe("PAUSED");
    const visible = gameReducer(hidden, pageVisible());
    expect(visible.speed).toBe("FAST");
  });

  it("keeps a deliberate pause through a background round trip", () => {
    const hidden = gameReducer(paused(), pageHidden());
    expect(hidden.speed).toBe("PAUSED");
    expect(gameReducer(hidden, pageVisible()).speed).toBe("PAUSED");
  });

  it("doesn't touch the clock outside a game", () => {
    // The menu and the scenario list have no clock to stop and nothing to put back
    const outOfGame = gameReducer(undefined, pageHidden());
    expect(outOfGame.speed).toBe("PAUSED");
    expect(gameReducer(outOfGame, pageVisible()).speed).toBe("PAUSED");
  });

  it("ignores a second hide and a stale return", () => {
    let state = gameReducer(running("SLOW"), pageHidden());
    state = gameReducer(state, pageHidden());
    expect(state.speed).toBe("PAUSED");
    state = gameReducer(state, pageVisible());
    expect(state.speed).toBe("SLOW");
    expect(gameReducer(state, pageVisible()).speed).toBe("SLOW");
  });

  it("blocks speed changes while the page is hidden, then resumes them", () => {
    const hidden = gameReducer(running("NORMAL"), pageHidden());
    expect(gameReducer(hidden, setSpeed("FAST")).speed).toBe("PAUSED");
    const visible = gameReducer(hidden, pageVisible());
    expect(visible.speed).toBe("NORMAL");
    expect(gameReducer(visible, setSpeed("FAST")).speed).toBe("FAST");
  });

  it("forgets the remembered speed when the scenario ends", () => {
    const hidden = gameReducer(running("FAST"), pageHidden());
    const quitted = gameReducer(hidden, quit());
    expect(gameReducer(quitted, pageVisible()).speed).toBe("PAUSED");
  });
});

describe("nesting with the pause owners it can sit under", () => {
  // A catalog already paused the clock, so the hide captures the catalog's pause. Returning
  // keeps it, and closing the catalog is what puts the player's speed back.
  it("stays paused under a build catalog, and its close restores the original speed", () => {
    const catalog = gameReducer(running("FAST"), navigate("BUILD_STORAGE"));
    const hidden = gameReducer(catalog, pageHidden());
    expect(hidden.speed).toBe("PAUSED");
    const visible = gameReducer(hidden, pageVisible());
    expect(visible.speed).toBe("PAUSED");
    expect(gameReducer(visible, navigateBack()).speed).toBe("FAST");
  });

  it("stays paused under the manual, and its close restores the original speed", () => {
    const reading = gameReducer(running("NORMAL"), manualHelpOpen("Interties"));
    const hidden = gameReducer(reading, pageHidden());
    expect(hidden.speed).toBe("PAUSED");
    const visible = gameReducer(hidden, pageVisible());
    expect(visible.speed).toBe("PAUSED");
    expect(gameReducer(visible, manualHelpClose()).speed).toBe("NORMAL");
  });

  // The other interleaving: hidden first, then a catalog opened on top. The catalog captures
  // the hidden pause, and returning must not resume underneath it - the sim would change the
  // quotes being read. The hidden capture is dropped; the catalog's close takes the speed
  // back to the pause it captured, and the player restarts the clock deliberately.
  it("does not resume under a catalog opened while hidden", () => {
    let state = gameReducer(running("NORMAL"), pageHidden());
    expect(state.speed).toBe("PAUSED");
    state = gameReducer(state, navigate("BUILD_STORAGE"));
    expect(state.speed).toBe("PAUSED");
    const visible = gameReducer(state, pageVisible());
    expect(visible.speed).toBe("PAUSED");
    expect(gameReducer(visible, navigate("FACILITIES")).speed).toBe("PAUSED");
  });
});
