import * as React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import Programs from "./Programs";
import { manualHelpOpen } from "../../reducers/UI";

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function showPrograms(scenarioId: number) {
  jest.useFakeTimers();
  const game = { ...createGame({ scenarioId }), speed: "FAST" as const };
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const onClose = jest.fn();
  const view = render(
    <Provider store={store}>
      <Programs onClose={onClose} />
    </Provider>,
  );
  return { store, onClose, ...view };
}

test("the embedded overview offers pricing without policies or a modal focus trap", () => {
  const { store } = showPrograms(3);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Electricity pricing" }),
  ).toBeVisible();
  expect(screen.getByRole("slider")).toBeEnabled();
  expect(store.getState().game.speed).toBe("FAST");
});

test("an embedded program decision pauses time and Escape returns to its overview", () => {
  const { store, onClose } = showPrograms(106);
  fireEvent.click(
    screen.getByRole("button", { name: "Time-of-use tariff · Off" }),
  );
  expect(screen.getByRole("region", { name: "Program details" })).toBeVisible();
  expect(store.getState().game.speed).toBe("PAUSED");
  // A separate rail keeps ownership of its own Escape; only this decision's controls go Back.
  const outside = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(outside);
  expect(outside.defaultPrevented).toBe(false);
  expect(screen.getByRole("region", { name: "Program details" })).toBeVisible();
  fireEvent.keyDown(
    screen.getByRole("heading", { name: "Time-of-use tariff" }),
    { key: "Escape" },
  );
  expect(
    screen.getByRole("region", { name: "Electricity pricing" }),
  ).toBeVisible();
  expect(store.getState().game.speed).toBe("FAST");
  expect(onClose).not.toHaveBeenCalled();
});

test("manual help keeps ownership of Escape while a program decision is open", () => {
  const { store, onClose } = showPrograms(106);
  fireEvent.click(
    screen.getByRole("button", { name: "Time-of-use tariff · Off" }),
  );
  act(() => store.dispatch(manualHelpOpen("Interties")));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("region", { name: "Program details" })).toBeVisible();
  expect(onClose).not.toHaveBeenCalled();
});
