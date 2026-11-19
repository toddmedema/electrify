import { configureStore } from "@reduxjs/toolkit";
import { purchaseFacility } from "./PurchaseFacility";
import gameReducer, { buildFacility } from "../reducers/Game";
import cardReducer from "../reducers/Card";
import uiReducer, { delta } from "../reducers/UI";
import userReducer from "../reducers/User";
import settingsReducer from "../reducers/Settings";
import savesReducer from "../SaveLibrary";
import { GENERATORS } from "../data/Facilities";
import { createGame } from "../testing/Simulator";
import { GeneratorShoppingType } from "../Types";
import { registerMultiplayerRuntime } from "../multiplayer/Registry";
import { availableTerritoryTiles } from "./TerritoryTiles";
import { currentTick } from "./GameSelectors";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import {
  withResilienceOptions,
  trackerHailDamageFactorForYear,
} from "./Hazards";
import { TRACKER_HAIL_PRO_YEAR } from "../data/Hazards";

it("acknowledges a purchase in the dispatching store, but not a rejected build", () => {
  const game = createGame({ scenarioId: 103 });
  const store = configureStore({
    reducer: {
      game: gameReducer,
      card: cardReducer,
      ui: uiReducer,
      user: userReducer,
      settings: settingsReducer,
      saves: savesReducer,
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
  expect(state.ui.snackbar.message).toContain(facility.name.toLowerCase());
});

it("waits for the requested tile and project rather than acknowledging an unrelated host addition", async () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  game.multiplayer = { seat: "0" };
  const store = configureStore({
    reducer: {
      game: gameReducer,
      card: cardReducer,
      ui: uiReducer,
      user: userReducer,
      settings: settingsReducer,
      saves: savesReducer,
    },
    preloadedState: { game },
    middleware: (defaults) =>
      defaults({ serializableCheck: false, immutableCheck: false }),
  });
  const facility = GENERATORS(game, 20e6, [], []).find(
    (option) => option.name === "Wind",
  )!;
  const [target, other] = availableTerritoryTiles(game, facility, "champlain");
  expect(other).toBeDefined();
  registerMultiplayerRuntime({
    submit: async () => undefined,
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
  try {
    const result = store.dispatch(
      purchaseFacility(facility, false, target.territoryId, target.id),
    );
    store.dispatch(
      buildFacility({
        facility,
        financed: false,
        territoryId: other.territoryId,
        tileId: other.id,
      }),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    expect(store.getState().ui.arrivingFacilityId).toBeUndefined();
    store.dispatch(
      buildFacility({
        facility,
        financed: false,
        territoryId: target.territoryId,
        tileId: target.id,
      }),
    );
    const accepted = await result;
    expect(accepted.status).toBe("accepted");
    expect(store.getState().ui.arrivingFacilityId).toBe(
      store
        .getState()
        .game.facilities.find((candidate) => candidate.tileId === target.id)!
        .id,
    );
  } finally {
    registerMultiplayerRuntime(undefined);
  }
});

it.each([
  "same run",
  "same options with updated equipment",
  "another tile",
  "another project",
  "another run",
  "existing facility",
])("handles receipt failure after projecting %s", async (projection) => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  game.multiplayer = { seat: "0" };
  const updatedEquipment = projection === "same options with updated equipment";
  if (updatedEquipment)
    game.date = getDateFromMinute(
      (TRACKER_HAIL_PRO_YEAR - game.startingYear) * 12 * MINUTES_PER_MONTH,
      game.startingYear,
    );
  const store = configureStore({
    reducer: {
      game: gameReducer,
      card: cardReducer,
      ui: uiReducer,
      user: userReducer,
      settings: settingsReducer,
      saves: savesReducer,
    },
    preloadedState: { game },
    middleware: (defaults) =>
      defaults({ serializableCheck: false, immutableCheck: false }),
  });
  const available = GENERATORS(game, 20e6, [], []).find(
    (option) => option.name === (updatedEquipment ? "Solar" : "Wind"),
  )!;
  const facility = updatedEquipment
    ? withResilienceOptions(available, game, { solarTrackers: true })
    : available;
  const reviewed = updatedEquipment
    ? {
        ...facility,
        resilience: {
          ...facility.resilience,
          trackerHailDamageFactor: trackerHailDamageFactorForYear(
            TRACKER_HAIL_PRO_YEAR - 1,
          ),
        },
      }
    : facility;
  const [target, other] = availableTerritoryTiles(game, facility, "champlain");
  expect(other).toBeDefined();
  const build = () =>
    store.dispatch(
      buildFacility({
        facility:
          projection === "another project"
            ? { ...facility, peakW: facility.peakW * 2 }
            : facility,
        financed: false,
        territoryId: target.territoryId,
        tileId: projection === "another tile" ? other.id : target.id,
      }),
    );
  if (projection === "existing facility") build();
  registerMultiplayerRuntime({
    submit: async () => {
      if (projection !== "existing facility") build();
      if (projection === "another run")
        store.dispatch(delta({ evidenceRunId: 1 }));
      throw new Error("Receipt connection lost");
    },
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
  try {
    const result = await store.dispatch(
      purchaseFacility(reviewed, false, target.territoryId, target.id),
    );
    const accepted = projection === "same run" || updatedEquipment;
    const built = store
      .getState()
      .game.facilities.find((candidate) => candidate.tileId === target.id);
    expect(result).toEqual(
      accepted
        ? { status: "accepted", facilityId: built?.id }
        : { status: "rejected", message: "Receipt connection lost" },
    );
    expect(store.getState().ui.arrivingFacilityId).toBe(
      accepted ? built?.id : undefined,
    );
    expect(store.getState().ui.snackbar.open).toBe(accepted);
  } finally {
    registerMultiplayerRuntime(undefined);
  }
});
