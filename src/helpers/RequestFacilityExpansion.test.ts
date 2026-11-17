import { configureStore } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import gameReducer, { delta as gameDelta } from "../reducers/Game";
import {
  expandFacility,
  cancelFacilityExpansion,
} from "../reducers/GameActions";
import cardReducer from "../reducers/Card";
import uiReducer, { delta as uiDelta } from "../reducers/UI";
import userReducer from "../reducers/User";
import settingsReducer from "../reducers/Settings";
import savesReducer from "../SaveLibrary";
import { createGame } from "../testing/Simulator";
import { currentCash, currentTick } from "./GameSelectors";
import {
  facilityExpansionQuote,
  completeFacilityExpansion,
} from "./FacilityExpansion";
import {
  requestFacilityExpansion,
  requestCancelFacilityExpansion,
} from "./RequestFacilityExpansion";
import { registerMultiplayerRuntime } from "../multiplayer/Registry";
import type { Command } from "../multiplayer/Types";

function setup(multiplayer = false) {
  const game = createGame({ scenarioId: 104, seed: 818 });
  currentTick(game)!.cash = 1e12;
  if (multiplayer) game.multiplayer = { seat: "0" };
  const facility = game.facilities[0];
  const quote = facilityExpansionQuote(game, facility.id, facility.peakW * 1.2);
  if (quote.status !== "ready") throw new Error(quote.reason);
  const payload = {
    facilityId: facility.id,
    targetSize: quote.targetSize,
    quoteKey: quote.quoteKey,
  };
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
  return { store, payload, quote, facility };
}
function runtime(submit: (command: Command) => Promise<void>) {
  registerMultiplayerRuntime({
    submit,
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
}
afterEach(() => registerMultiplayerRuntime(undefined));

it("acknowledges only accepted local upgrades and a single cancellation refund", async () => {
  const { store, payload, quote } = setup();
  const cash = currentCash(store.getState().game);
  expect(await store.dispatch(requestFacilityExpansion(payload))).toEqual({
    status: "accepted",
  });
  expect(currentCash(store.getState().game)).toBeCloseTo(cash - quote.cost, 2);
  expect((await store.dispatch(requestFacilityExpansion(payload))).status).toBe(
    "rejected",
  );
  expect(
    await store.dispatch(requestCancelFacilityExpansion(payload.facilityId)),
  ).toEqual({ status: "accepted", refund: quote.cost });
  expect(currentCash(store.getState().game)).toBeCloseTo(cash, 2);
  expect(
    (await store.dispatch(requestCancelFacilityExpansion(payload.facilityId)))
      .status,
  ).toBe("rejected");
  expect(currentCash(store.getState().game)).toBeCloseTo(cash, 2);
});

it.each(["stale", "shrinking", "unaffordable"])(
  "rejects a %s review without sending it to the host",
  async (kind) => {
    const { store, payload, facility } = setup(true);
    const submit = jest.fn(async () => undefined);
    runtime(submit);
    if (kind === "stale") payload.quoteKey = "previous-month";
    if (kind === "shrinking") payload.targetSize = facility.peakW;
    if (kind === "unaffordable") {
      const timeline = cloneDeep(store.getState().game.timeline);
      currentTick({ ...store.getState().game, timeline })!.cash = 0;
      store.dispatch(gameDelta({ timeline }));
    }
    expect(
      (await store.dispatch(requestFacilityExpansion(payload))).status,
    ).toBe("rejected");
    expect(submit).not.toHaveBeenCalled();
    expect(
      store.getState().game.facilities[0].expansionInProgress,
    ).toBeUndefined();
  },
);

it("does not apply co-op construction locally when disconnected", async () => {
  const { store, payload } = setup(true);
  const cash = currentCash(store.getState().game);
  const result = await store.dispatch(requestFacilityExpansion(payload));
  expect(result).toEqual({
    status: "rejected",
    message: "Reconnect to co-op before starting this upgrade.",
  });
  expect(currentCash(store.getState().game)).toBe(cash);
  expect(
    store.getState().game.facilities[0].expansionInProgress,
  ).toBeUndefined();
});

it("waits after the receipt for the exact target and quote rather than an unrelated projected expansion", async () => {
  const { store, payload, facility } = setup(true);
  const submit = jest.fn(async () => undefined);
  runtime(submit);
  let settled = false;
  const result = store
    .dispatch(requestFacilityExpansion(payload))
    .then((value) => {
      settled = true;
      return value;
    });
  expect(submit).toHaveBeenCalledWith({
    kind: "action",
    name: "expandFacility",
    payload,
  });
  const other = facilityExpansionQuote(
    store.getState().game,
    facility.id,
    facility.peakW * 1.1,
  );
  if (other.status !== "ready") throw new Error(other.reason);
  store.dispatch(
    expandFacility({
      facilityId: facility.id,
      targetSize: other.targetSize,
      quoteKey: other.quoteKey,
    }),
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  expect(settled).toBe(false);
  store.dispatch(cancelFacilityExpansion(facility.id));
  store.dispatch(expandFacility(payload));
  expect(await result).toEqual({ status: "accepted" });
});

it.each([false, true])(
  "handles a lost host receipt only when the exact project arrived in the same run (changed=%s)",
  async (changed) => {
    const { store, payload } = setup(true);
    runtime(async () => {
      store.dispatch(expandFacility(payload));
      if (changed) store.dispatch(uiDelta({ evidenceRunId: 1 }));
      throw new Error("Receipt connection lost");
    });
    expect(await store.dispatch(requestFacilityExpansion(payload))).toEqual(
      changed
        ? { status: "rejected", message: "Receipt connection lost" }
        : { status: "accepted" },
    );
  },
);

it("stops waiting when the run changes before the projected expansion arrives", async () => {
  const { store, payload } = setup(true);
  runtime(async () => {
    store.dispatch(uiDelta({ evidenceRunId: 1 }));
  });
  expect((await store.dispatch(requestFacilityExpansion(payload))).status).toBe(
    "rejected",
  );
});

it("waits for authoritative cancellation rather than treating its receipt as a refund", async () => {
  const { store, payload, quote } = setup(true);
  store.dispatch(expandFacility(payload));
  const submit = jest.fn(async () => undefined);
  runtime(submit);
  let settled = false;
  const result = store
    .dispatch(requestCancelFacilityExpansion(payload.facilityId))
    .then((value) => {
      settled = true;
      return value;
    });
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  expect(submit).toHaveBeenCalledWith({
    kind: "action",
    name: "cancelFacilityExpansion",
    payload: payload.facilityId,
  });
  expect(settled).toBe(false);
  store.dispatch(cancelFacilityExpansion(payload.facilityId));
  expect(await result).toEqual({ status: "accepted", refund: quote.cost });
});

it("reports completed construction without claiming a cancellation refund", async () => {
  const { store, payload } = setup(true);
  store.dispatch(expandFacility(payload));
  const cash = currentCash(store.getState().game);
  runtime(async () => {
    const facilities = cloneDeep(store.getState().game.facilities);
    facilities[0].expansionInProgress!.yearsToBuildLeft = 0;
    completeFacilityExpansion(facilities[0]);
    store.dispatch(gameDelta({ facilities }));
  });
  expect(
    await store.dispatch(requestCancelFacilityExpansion(payload.facilityId)),
  ).toEqual({
    status: "completed",
    message: expect.stringContaining("no refund was issued"),
  });
  expect(currentCash(store.getState().game)).toBe(cash);
});

it("rejects a cancellation after a run change even if its plant ID matches", async () => {
  const { store, payload } = setup(true);
  store.dispatch(expandFacility(payload));
  runtime(async () => {
    store.dispatch(cancelFacilityExpansion(payload.facilityId));
    store.dispatch(uiDelta({ evidenceRunId: 1 }));
    throw new Error("Run changed");
  });
  expect(
    await store.dispatch(requestCancelFacilityExpansion(payload.facilityId)),
  ).toEqual({ status: "rejected", message: "Run changed" });
});

it("rejects a cancellation review belonging to a different project", async () => {
  const { store, payload } = setup(true);
  store.dispatch(expandFacility(payload));
  const submit = jest.fn(async () => undefined);
  runtime(submit);
  expect(
    (
      await store.dispatch(
        requestCancelFacilityExpansion(payload.facilityId, "old-project"),
      )
    ).status,
  ).toBe("rejected");
  expect(submit).not.toHaveBeenCalled();
  expect(
    store.getState().game.facilities[0].expansionInProgress?.quoteKey,
  ).toBe(payload.quoteKey);
});
