import * as React from "react";
import { Provider } from "react-redux";
import { render, act } from "@testing-library/react";
import { store } from "../../Store";
import { createGame } from "../../testing/Simulator";
import { currentTick } from "../../helpers/GameSelectors";
import { GameType } from "../../Types";
import { quit, resume, loaded, delta, setSpeed } from "../../reducers/Game";
import { dialogClose, dialogOpen } from "../../reducers/UI";
import LowCashWarning, { offerLowCashWarning } from "./LowCashWarning";

function start(game?: GameType) {
  const candidate = game ?? createGame({ scenarioId: 100, seed: 123 });
  currentTick(candidate)!.cash = 90_000;
  candidate.dollarsPerkWh = 0.001;
  store.dispatch(resume(candidate));
  store.dispatch(loaded());
  store.dispatch(setSpeed("NORMAL"));
}

beforeEach(() => {
  jest.useFakeTimers();
  store.dispatch(quit());
  start();
});
afterEach(() => {
  store.dispatch(dialogClose());
  store.dispatch(quit());
  jest.useRealTimers();
});

it("pauses, quotes the exact accepted rate, records it for replay, and resumes", () => {
  store.dispatch(offerLowCashWarning());
  const { dialog } = store.getState().ui;
  expect(store.getState().game.speed).toBe("PAUSED");
  expect(dialog.title).toBe(
    "You're about to run out of cash - raise your rates?",
  );
  expect(dialog.secondaryLabel).toBe("Go bankrupt");
  expect(dialog.actionLabel).toBe("Raise rates");
  expect(dialog.notCancellable).toBe(true);
  const price = Number(String(dialog.message).match(/to ([\d.]+)c\/kWh/)![1]);
  expect(dialog.message).toContain("to avoid bankruptcy this month.");
  store.dispatch(setSpeed("FAST"));
  expect(store.getState().game.speed).toBe("PAUSED");
  dialog.action!({} as React.MouseEvent<HTMLElement>);
  expect(store.getState().game.dollarsPerkWh).toBeCloseTo(price / 100, 10);
  expect(store.getState().game.replayLog?.at(-1)).toMatchObject({
    type: "delta",
    payload: { dollarsPerkWh: store.getState().game.dollarsPerkWh },
  });
  expect(store.getState().game.speed).toBe("NORMAL");
});

it("declines without changing rates, offers only once per month, and resets on the next month", () => {
  store.dispatch(offerLowCashWarning());
  store.getState().ui.dialog.secondaryAction!(
    {} as React.MouseEvent<HTMLElement>,
  );
  expect(store.getState().game.dollarsPerkWh).toBe(0.001);
  expect(store.getState().game.speed).toBe("NORMAL");
  store.dispatch(offerLowCashWarning());
  expect(store.getState().ui.dialog.open).toBe(false);
  store.dispatch(
    delta({ date: { ...store.getState().game.date, monthsElapsed: 1 } }),
  );
  store.dispatch(offerLowCashWarning());
  expect(store.getState().ui.dialog.open).toBe(true);
  expect(store.getState().game.lowCashWarningMonth).toBe(1);
});

it("opens automatically exactly once under StrictMode and stays paused if play was paused", () => {
  store.dispatch(setSpeed("PAUSED"));
  const spy = jest.spyOn(store, "dispatch");
  render(
    <Provider store={store}>
      <React.StrictMode>
        <LowCashWarning />
      </React.StrictMode>
    </Provider>,
  );
  expect(store.getState().ui.dialog.open).toBe(true);
  act(() => {
    store.getState().ui.dialog.secondaryAction!(
      {} as React.MouseEvent<HTMLElement>,
    );
  });
  expect(store.getState().ui.dialog.open).toBe(false);
  expect(store.getState().game.speed).toBe("PAUSED");
  spy.mockRestore();
});

it("waits behind another prompt and never offers during replay or above the threshold", () => {
  store.dispatch(
    dialogOpen({ title: "Another prompt", message: "", open: true }),
  );
  store.dispatch(offerLowCashWarning());
  expect(store.getState().ui.dialog.title).toBe("Another prompt");
  store.dispatch(dialogClose());
  store.dispatch(delta({ replayPlayback: { actions: [], index: 0 } }));
  store.dispatch(offerLowCashWarning());
  expect(store.getState().ui.dialog.open).toBe(false);
  const game = createGame({ scenarioId: 100, seed: 123 });
  currentTick(game)!.cash = 100_000;
  store.dispatch(resume(game));
  store.dispatch(loaded());
  store.dispatch(offerLowCashWarning());
  expect(store.getState().ui.dialog.open).toBe(false);
});

it("explains the board cap instead of offering a price that cannot be applied", () => {
  const game = createGame({ scenarioId: 104, seed: 123 });
  currentTick(game)!.cash = -1e12;
  store.dispatch(resume(game));
  store.dispatch(loaded());
  store.dispatch(offerLowCashWarning());
  const dialog = store.getState().ui.dialog;
  expect(dialog.message).toContain(
    "Rates alone cannot prevent bankruptcy this month.",
  );
  expect(dialog.message).toContain("utility board's maximum rate");
  expect(dialog.action).toBeUndefined();
});
