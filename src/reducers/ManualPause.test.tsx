import gameReducer, { setSpeed } from "./Game";
import cardReducer, { navigate, navigateBack } from "./Card";
import { quit } from "./GameActions";
import { GameType } from "../Types";

function running(speed: "SLOW" | "NORMAL" | "FAST" = "FAST"): GameType {
  const state = gameReducer(undefined, setSpeed(speed));
  return { ...state, inGame: true };
}

describe("the manual pausing the game", () => {
  it("pauses on the way in and restores the speed on the way back", () => {
    const paused = gameReducer(running("FAST"), navigate("MANUAL"));
    expect(paused.speed).toBe("PAUSED");
    expect(gameReducer(paused, navigateBack()).speed).toBe("FAST");
  });

  it("restores the speed when leaving the manual forwards too", () => {
    const paused = gameReducer(running("SLOW"), navigate("MANUAL"));
    expect(gameReducer(paused, navigate("FACILITIES")).speed).toBe("SLOW");
  });

  it("leaves a deliberate pause alone", () => {
    const state = {
      ...gameReducer(undefined, setSpeed("PAUSED")),
      inGame: true,
    };
    const inManual = gameReducer(state, navigate("MANUAL"));
    expect(gameReducer(inManual, navigateBack()).speed).toBe("PAUSED");
  });

  it("restores the speed the player arrived with", () => {
    const paused = gameReducer(running("NORMAL"), navigate("MANUAL"));
    // Re-pausing an already-paused game shouldn't change what we put back
    const stillPaused = gameReducer(paused, setSpeed("PAUSED"));
    expect(gameReducer(stillPaused, navigateBack()).speed).toBe("NORMAL");
  });

  it("doesn't touch the clock outside a game", () => {
    // The manual is reachable from the title screen and the scenario list, where there's no
    // game to pause and nothing to put back
    const outOfGame = gameReducer(undefined, navigate("MANUAL"));
    expect(outOfGame.speed).toBe("PAUSED");
    expect(gameReducer(outOfGame, navigateBack()).speed).toBe("PAUSED");
  });

  it("forgets the remembered speed when the scenario ends", () => {
    const paused = gameReducer(running("FAST"), navigate("MANUAL"));
    const quitted = gameReducer(paused, quit());
    expect(gameReducer(quitted, navigateBack()).speed).toBe("PAUSED");
  });
});

describe("deep linking into a manual entry", () => {
  it("carries the entry through navigation", () => {
    const state = cardReducer(
      undefined,
      navigate({ name: "MANUAL", entry: "Total Cost of Energy" }),
    );
    expect(state.name).toBe("MANUAL");
    expect(state.entry).toBe("Total Cost of Energy");
  });

  it("doesn't reopen the last deep link on a later plain visit", () => {
    const deepLinked = cardReducer(
      undefined,
      navigate({ name: "MANUAL", entry: "Ramp Rate" }),
    );
    const back = cardReducer(deepLinked, navigateBack());
    expect(back.entry).toBeUndefined();
    expect(cardReducer(back, navigate("MANUAL")).entry).toBeUndefined();
  });
});
