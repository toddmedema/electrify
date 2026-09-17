import gameReducer from "../reducers/Game";
import { configureStore } from "@reduxjs/toolkit";
import card, { navigate, navigateBack } from "../reducers/Card";
import ui, { requestEvidence } from "../reducers/UI";
import { quit, resume, startReplay, loaded } from "../reducers/GameActions";
import {
  beginGeneratorJourney,
  returnToEvidence,
  traverseEvidenceJourney,
} from "./EvidenceJourney";
import type { AppDispatch } from "../Store";
import type { InsightsOriginType } from "../Types";

const origin: InsightsOriginType = {
  viewport: [0, 69120],
  month: 0,
  layers: ["supplyDemand"],
  preset: "grid",
  revision: 0,
  scrollTop: 128,
  anchor: "supplyDemand",
};
function fixture() {
  const store = configureStore({
    reducer: { card, ui, game: (state = { date: {} }) => state },
  });
  const dispatch = store.dispatch as AppDispatch;
  dispatch(navigate("FACILITIES"));
  dispatch(navigate("INSIGHTS"));
  return { store, dispatch };
}

it("replaces the origin, pushes one control, and Return only traverses browser history", () => {
  const { store, dispatch } = fixture();
  const push = jest.spyOn(window.history, "pushState");
  const replace = jest.spyOn(window.history, "replaceState");
  const back = jest
    .spyOn(window.history, "back")
    .mockImplementation(() => undefined);
  const game = store.getState().game;
  dispatch(beginGeneratorJourney(origin));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(push).toHaveBeenCalledTimes(1);
  expect(store.getState().card.name).toBe("BUILD_GENERATORS");
  const cardBeforeReturn = store.getState().card;
  dispatch(returnToEvidence());
  expect(back).toHaveBeenCalledTimes(1);
  expect(store.getState().card).toBe(cardBeforeReturn);
  expect(store.getState().game).toBe(game);
  jest.restoreAllMocks();
});

it("Back consumes the origin; Forward visits the control ordinarily without recreating Return", () => {
  const { store, dispatch } = fixture();
  dispatch(beginGeneratorJourney(origin));
  const marker = store.getState().ui.evidenceJourneyMarker!;
  const push = jest.spyOn(window.history, "pushState");
  expect(
    dispatch(
      traverseEvidenceJourney({
        evidenceJourney: { ...marker, role: "origin" },
      }),
    ),
  ).toBe(true);
  expect(store.getState().card.history?.slice(0, 2)).toEqual([
    "INSIGHTS",
    "FACILITIES",
  ]);
  expect(store.getState().ui.insightsRestore).toEqual(origin);
  expect(store.getState().ui.evidenceJourney).toBeUndefined();
  dispatch(
    traverseEvidenceJourney({
      evidenceJourney: { ...marker, role: "control" },
    }),
  );
  expect(store.getState().card.name).toBe("BUILD_GENERATORS");
  expect(store.getState().ui.evidenceJourney).toBeUndefined();
  dispatch(
    traverseEvidenceJourney({ evidenceJourney: { ...marker, role: "origin" } }),
  );
  expect(store.getState().ui.insightsRestore).toBeUndefined();
  dispatch(navigateBack());
  expect(store.getState().card.name).toBe("FACILITIES");
  expect(push).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

it("ordinary navigation and replacement evidence end the one edge", () => {
  const { store, dispatch } = fixture();
  dispatch(beginGeneratorJourney(origin));
  dispatch(navigate("EVENTS"));
  expect(store.getState().ui.evidenceJourney).toBeUndefined();
  dispatch(beginGeneratorJourney(origin));
  dispatch(requestEvidence("finances"));
  expect(store.getState().ui.evidenceJourney).toBeUndefined();
});

it("clears on lifecycle changes and rejects expired markers without swallowing public routes", () => {
  for (const reset of [
    quit(),
    resume({} as never),
    startReplay({} as never),
    loaded(),
    { type: "game/initGame" },
  ]) {
    const { store, dispatch } = fixture();
    dispatch(beginGeneratorJourney(origin));
    const marker = store.getState().ui.evidenceJourneyMarker!;
    dispatch(reset);
    expect(store.getState().ui.evidenceJourney).toBeUndefined();
    expect(store.getState().ui.evidenceJourneyMarker).toBeUndefined();
    expect(dispatch(traverseEvidenceJourney(null))).toBe(false);
    dispatch(
      traverseEvidenceJourney({
        evidenceJourney: { ...marker, role: "origin" },
      }),
    );
    expect(store.getState().ui.insightsRestore).toBeUndefined();
  }
});

it("Return does not resume the real simulation or retain a pending construction resume", () => {
  const store = configureStore({
    reducer: { card, ui, game: gameReducer },
    preloadedState: {
      game: {
        ...gameReducer(undefined, { type: "@@init" }),
        inGame: true,
        speed: "FAST" as const,
      },
    },
  });
  const dispatch = store.dispatch as AppDispatch;
  dispatch(navigate("INSIGHTS"));
  dispatch(beginGeneratorJourney(origin));
  expect(store.getState().game.speed).toBe("PAUSED");
  const pausedGame = store.getState().game;
  const marker = store.getState().ui.evidenceJourneyMarker!;
  dispatch(
    traverseEvidenceJourney({ evidenceJourney: { ...marker, role: "origin" } }),
  );
  expect(store.getState().game).toBe(pausedGame);
  dispatch(navigate("FACILITIES"));
  expect(store.getState().game.speed).toBe("PAUSED");
});
