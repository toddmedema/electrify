import { initWeather } from "../../data/Weather";
import * as Weather from "../../data/Weather";
import * as Economy from "../../data/Economy";
import * as FuelPrices from "../../data/FuelPrices";
import { createGame } from "../../testing/Simulator";
import { tickState } from "../../reducers/Game";
import { parseSave, serializeSave } from "../../SaveGame";
import cardReducer, {
  initialCard,
  navigate,
  navigateBack,
} from "../../reducers/Card";
import { loaded, start, resume, launchRun } from "../../reducers/GameActions";
import { UnknownAction } from "@reduxjs/toolkit";
import { TUTORIALS } from "../../data/Scenarios";
import { store } from "../../Store";
import {
  restoreLoadedTutorial,
  restoreTutorialAfterLoading,
  weatherFailureMessage,
  mapDispatchToProps,
} from "./LoadingContainer";

it.each([false, true])(
  "finishes deferred agreement price validation after loading (forged payment: %s)",
  async (forged) => {
    const game = createGame({ scenarioId: 116, seed: 12345 });
    tickState(game);
    const wire = JSON.parse(JSON.stringify(serializeSave(game)));
    if (forged)
      wire.game.transmission.agreementAccounts[0].months[0].payment += 1;
    const unloaded = jest.spyOn(Economy, "hasEconomy").mockReturnValue(false);
    const parsed = parseSave(wire);
    expect(parsed).not.toBeNull();
    unloaded.mockRestore();
    const economy = jest
      .spyOn(Economy, "initEconomy")
      .mockImplementation((done) => done?.());
    const fuel = jest
      .spyOn(FuelPrices, "initFuelPrices")
      .mockImplementation((done) => done?.());
    const weather = jest
      .spyOn(Weather, "initWeather")
      .mockImplementation((_location, done) => done?.());
    try {
      const dispatch = jest.fn();
      const onError = jest.fn();
      await mapDispatchToProps(dispatch as never).load(parsed!.game, onError);
      expect(onError.mock.calls).toEqual(
        forged ? [[expect.stringContaining("power agreement history")]] : [],
      );
      expect(dispatch.mock.calls).toEqual(forged ? [] : [[loaded()]]);
      expect(parseSave(wire) === null).toBe(forged);
    } finally {
      economy.mockRestore();
      fuel.mockRestore();
      weather.mockRestore();
    }
  },
);

it("restores a capstone's authored pane after rebuilding its scenario", () => {
  const finances = TUTORIALS.find((tutorial) => tutorial.id === 4)!;
  const capstone = finances.tutorialSteps!.findIndex((step) => step.capstone);
  const dispatched: UnknownAction[] = [];

  restoreTutorialAfterLoading(
    ((action: UnknownAction) => {
      dispatched.push(action);
      return action;
    }) as never,
    finances.tutorialSteps!,
    capstone,
  );

  expect(dispatched).toEqual([
    expect.objectContaining({ type: "card/navigate", payload: "PROGRAMS" }),
    expect.objectContaining({
      type: "game/delta",
      payload: { tutorialStep: capstone },
    }),
  ]);
});

it.each([
  { inGame: false, tutorialStep: 4, scenarioId: 0, expectedActions: 0 },
  { inGame: true, tutorialStep: 2, scenarioId: 0, expectedActions: 0 },
  { inGame: true, tutorialStep: 3, scenarioId: 2, expectedActions: 0 },
  { inGame: true, tutorialStep: 4, scenarioId: 0, expectedActions: 2 },
])(
  "only restores the loaded tutorial that requested the callback: %p",
  (current) => {
    const state = store.getState();
    const requested = { ...state.game, scenarioId: 0, tutorialStep: 4 };
    const dispatch = jest.fn();
    restoreLoadedTutorial(
      requested,
      TUTORIALS.find((tutorial) => tutorial.id === 0)!.tutorialSteps!,
    )(
      dispatch,
      () => ({
        ...state,
        card: { ...state.card, name: "FACILITIES" },
        game: { ...requested, ...current },
      }),
      undefined,
    );
    expect(dispatch).toHaveBeenCalledTimes(current.expectedActions);
  },
);

it("a delayed tutorial restoration cannot replace a screen the player opened", () => {
  const state = store.getState();
  const requested = {
    ...state.game,
    inGame: true,
    scenarioId: 1,
    tutorialStep: -1,
  };
  const dispatch = jest.fn();
  restoreLoadedTutorial(
    requested,
    TUTORIALS.find((tutorial) => tutorial.id === 1)!.tutorialSteps!,
  )(
    dispatch,
    () => ({
      ...state,
      game: requested,
      card: { ...state.card, name: "ACHIEVEMENTS" },
    }),
    undefined,
  );
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: "game/delta", payload: { tutorialStep: 0 } },
  ]);
});

it.each([start.type, resume.type, launchRun.type])(
  "%s finishes loading without taking navigation from the player's newer screen",
  (type) => {
    const loading = cardReducer(initialCard, { type });
    expect(cardReducer(loading, loaded()).name).toBe("FACILITIES");
    const gallery = cardReducer(loading, navigate("ACHIEVEMENTS"));
    expect(cardReducer(gallery, navigateBack()).name).toBe("LOADING");
    const completedGallery = cardReducer(gallery, loaded());
    expect(completedGallery.name).toBe("ACHIEVEMENTS");
    expect(completedGallery.ts).toBe(gallery.ts);
    expect(cardReducer(completedGallery, navigateBack()).name).toBe(
      "FACILITIES",
    );
    const manual = cardReducer(gallery, navigate("MANUAL"));
    const finished = cardReducer(manual, loaded());
    expect(finished.name).toBe("MANUAL");
    expect(finished.ts).toBe(manual.ts);
    const back = cardReducer(finished, navigateBack());
    expect(back.name).toBe("ACHIEVEMENTS");
    expect(cardReducer(back, navigateBack()).name).toBe("FACILITIES");
  },
);

it("names the place and the remedy for a weather download failure, logging the cause", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const raw = "Could not fetch the weather for SF: Failed to fetch";
    expect(weatherFailureMessage(raw, "San Francisco, CA")).toBe(
      "Could not load the weather for San Francisco, CA. Check your connection and try again.",
    );
    expect(warn).toHaveBeenCalledWith(raw);
    const other = '"x" is not a location id weather can be loaded for';
    expect(weatherFailureMessage(other, "Anywhere")).toBe(other);
  } finally {
    warn.mockRestore();
  }
});

it.each([404, 503])(
  "preserves HTTP %s weather failures without connection advice",
  async (status) => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status });
    try {
      const failure = await new Promise<string | undefined>((resolve) =>
        initWeather("SF", resolve),
      );
      expect(weatherFailureMessage(failure!, "San Francisco, CA")).toBe(
        `Could not load the weather for SF: ${status} fetching SF's weather file`,
      );
    } finally {
      global.fetch = originalFetch;
    }
  },
);

it("preserves weather decoding failures without connection advice", async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    const failure = await new Promise<string | undefined>((resolve) =>
      initWeather("SF", resolve),
    );
    expect(weatherFailureMessage(failure!, "San Francisco, CA")).toBe(
      "Could not load the weather for SF: Weather file is 0 bytes, too short to be one",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

it("gives connection advice when the weather fetch rejects", async () => {
  const originalFetch = global.fetch;
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  try {
    const failure = await new Promise<string | undefined>((resolve) =>
      initWeather("SF", resolve),
    );
    expect(weatherFailureMessage(failure!, "San Francisco, CA")).toBe(
      "Could not load the weather for San Francisco, CA. Check your connection and try again.",
    );
  } finally {
    global.fetch = originalFetch;
    warn.mockRestore();
  }
});
