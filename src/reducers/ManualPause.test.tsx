import gameReducer, { setSpeed } from "./Game";
import cardReducer, { navigate, navigateBack } from "./Card";
import { manualHelpOpen, manualHelpClose } from "./UI";
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

describe("construction catalogs pausing the game", () => {
  it.each(["BUILD_GENERATORS", "BUILD_STORAGE"] as const)(
    "pauses %s and restores the prior speed when it closes",
    (card) => {
      const paused = gameReducer(running("FAST"), navigate(card));
      expect(paused.speed).toBe("PAUSED");
      expect(gameReducer(paused, navigateBack()).speed).toBe("FAST");
    },
  );

  it("stays paused if a global speed shortcut fires while the catalog is open", () => {
    const paused = gameReducer(running("NORMAL"), navigate("BUILD_STORAGE"));
    expect(gameReducer(paused, setSpeed("FAST")).speed).toBe("PAUSED");
    expect(gameReducer(paused, navigate("FACILITIES")).speed).toBe("NORMAL");
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

describe("contextual manual help", () => {
  beforeEach(() => {
    gameReducer(undefined, quit());
  });
  it("keeps the catalog paused when help closes and restores speed only on leaving the catalog", () => {
    const catalog = gameReducer(running("FAST"), navigate("BUILD_STORAGE"));
    const reading = gameReducer(catalog, manualHelpOpen("Power and Energy"));
    const related = gameReducer(
      reading,
      manualHelpOpen("Round-trip Efficiency"),
    );
    const returned = gameReducer(related, manualHelpClose());
    expect(returned.speed).toBe("PAUSED");
    expect(gameReducer(returned, navigateBack()).speed).toBe("FAST");
  });
  it("pauses running Insights, blocks speed changes, and restores its prior speed", () => {
    const reading = gameReducer(
      running("NORMAL"),
      manualHelpOpen("Reserve Capacity"),
    );
    expect(reading.speed).toBe("PAUSED");
    expect(gameReducer(reading, setSpeed("FAST")).speed).toBe("PAUSED");
    expect(gameReducer(reading, manualHelpClose()).speed).toBe("NORMAL");
  });
  it("does not resume a deliberate pause or retain it after quitting", () => {
    const paused = { ...running(), speed: "PAUSED" as const };
    expect(
      gameReducer(
        gameReducer(paused, manualHelpOpen("Interties")),
        manualHelpClose(),
      ).speed,
    ).toBe("PAUSED");
    const reading = gameReducer(running("FAST"), manualHelpOpen("Interties"));
    expect(
      gameReducer(gameReducer(reading, quit()), manualHelpClose()).speed,
    ).toBe("PAUSED");
  });
});
