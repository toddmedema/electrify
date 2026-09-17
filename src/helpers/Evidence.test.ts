import { configureStore } from "@reduxjs/toolkit";
import type { AppDispatch } from "../Store";
import { evidenceCard, focusEvidence, openEvidence } from "./Evidence";
import uiReducer, {
  requestEvidence,
  setFacilityDragActive,
} from "../reducers/UI";
import cardReducer, { navigate } from "../reducers/Card";
import {
  loaded,
  quit,
  resume,
  start,
  startReplay,
} from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";

function fixture() {
  const game = createGame({ scenarioId: 101, seed: 357 });
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      card: cardReducer,
      game: () => game,
    },
  });
  return { store, dispatch: store.dispatch as AppDispatch, game };
}

it("maps semantic destinations and repeats same-card requests without changing simulation state", () => {
  const { store, dispatch, game } = fixture();
  dispatch(openEvidence("supply-demand"));
  const first = store.getState().ui.evidenceRequest!;
  expect(store.getState().card.name).toBe("FACILITIES");
  dispatch(openEvidence("supply-demand"));
  expect(store.getState().ui.evidenceRequest!.id).toBe(first.id + 1);
  expect(store.getState().game).toBe(game);
  expect(evidenceCard("finances")).toBe("INSIGHTS");
  expect(evidenceCard("mission-details")).toBeUndefined();
  expect(evidenceCard({ card: "FACILITIES", view: "BUILD_GENERATORS" })).toBe(
    "BUILD_GENERATORS",
  );
});

it("defers during drag, claims focus once, and ignores obsolete requests", () => {
  const { store, dispatch } = fixture();
  const element = document.createElement("section");
  element.tabIndex = -1;
  document.body.append(element);
  const focus = jest.spyOn(element, "focus");
  dispatch(requestEvidence("finances"));
  const request = store.getState().ui.evidenceRequest!;
  dispatch(setFacilityDragActive(true));
  expect(dispatch(focusEvidence(request, element))).toBe(false);
  dispatch(setFacilityDragActive(false));
  expect(dispatch(focusEvidence(request, element))).toBe(true);
  expect(dispatch(focusEvidence(request, element))).toBe(false);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(element);
  dispatch(requestEvidence("finances"));
  const obsolete = store.getState().ui.evidenceRequest!;
  dispatch(requestEvidence("supply-demand"));
  expect(dispatch(focusEvidence(obsolete, element))).toBe(false);
  expect(store.getState().ui.evidenceRequest!.target).toBe("supply-demand");
  element.remove();
});

it("cancels requests on ordinary navigation and every run lifecycle boundary", () => {
  for (const action of [
    navigate("EVENTS"),
    start(101),
    loaded(),
    quit(),
    { type: resume.type },
    { type: startReplay.type },
    { type: "game/initGame" },
  ]) {
    const state = uiReducer(undefined, requestEvidence("finances"));
    const next = uiReducer(state, action);
    expect(next.evidenceRequest).toBeUndefined();
    expect(next.evidenceRunId).toBe(
      action.type === navigate.type ? undefined : 1,
    );
  }
});

it("does not acknowledge a destination until its actual element exists", () => {
  const { store, dispatch } = fixture();
  dispatch(requestEvidence("finances"));
  const request = store.getState().ui.evidenceRequest!;
  expect(dispatch(focusEvidence(request, null))).toBe(false);
  expect(store.getState().ui.evidenceRequest).toEqual(request);
});
