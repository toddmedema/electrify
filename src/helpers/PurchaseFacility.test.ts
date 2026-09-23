import { configureStore } from "@reduxjs/toolkit";
import { purchaseFacility } from "./PurchaseFacility";
import gameReducer from "../reducers/Game";
import cardReducer from "../reducers/Card";
import uiReducer from "../reducers/UI";
import userReducer from "../reducers/User";
import settingsReducer from "../reducers/Settings";
import { GENERATORS } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import { GeneratorShoppingType } from "../Types";

it("acknowledges a purchase in the dispatching store, but not a rejected build", () => {
  const game = createGame({ scenarioId: 103 });
  const store = configureStore({
    reducer: {
      game: gameReducer,
      card: cardReducer,
      ui: uiReducer,
      user: userReducer,
      settings: settingsReducer,
    },
    preloadedState: { game },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }),
  });
  store.dispatch(purchaseFacility({} as GeneratorShoppingType, false));
  expect(store.getState().ui.arrivingFacilityId).toBeUndefined();
  const facility = GENERATORS(game, 500000000, [20], [500]).find(
    (candidate) => candidate.available && candidate.fuel === "Natural Gas",
  )!;
  store.dispatch(purchaseFacility(facility, true));
  const state = store.getState();
  expect(state.game.facilities).toHaveLength(game.facilities.length + 1);
  expect(state.ui.arrivingFacilityId).toBe(
    state.game.facilities.find(
      (candidate) =>
        !game.facilities.some((before) => before.id === candidate.id),
    )!.id,
  );
  expect(state.ui.snackbar.open).toBe(true);
  expect(state.ui.snackbar.message).toContain(facility.name);
});
