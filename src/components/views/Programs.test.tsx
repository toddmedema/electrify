import * as React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import Programs from "./Programs";
import { manualHelpOpen } from "../../reducers/UI";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import cardReducer, { initialCard } from "../../reducers/Card";
import { GameAppBar } from "../base/GameAppBar";

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function showPrograms(scenarioId: number, withAppBar = false) {
  jest.useFakeTimers();
  const game = {
    ...createGame({ scenarioId }),
    inGame: true,
    speed: "FAST" as const,
  };
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer, card: cardReducer },
    preloadedState: {
      game,
      card: {
        ...initialCard,
        name: withAppBar ? ("PROGRAMS" as const) : ("FACILITIES" as const),
      },
    },
  });
  const onClose = jest.fn();
  const view = render(
    <Provider store={store}>
      {withAppBar && (
        <GameAppBar
          game={game}
          onManual={jest.fn()}
          onNextTutorial={jest.fn()}
          onQuit={jest.fn()}
          onSettings={jest.fn()}
          onSpeedChange={jest.fn()}
        />
      )}
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

test("Escape dismisses the app menu before leaving an unsaved program decision", () => {
  const { store } = showPrograms(106, true);
  fireEvent.click(
    screen.getByRole("button", { name: "Time-of-use tariff · Off" }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "On" }));
  fireEvent.change(screen.getByLabelText("Daily window"), {
    target: { value: "22" },
  });
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  act(() => jest.advanceTimersByTime(300));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Program details" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "On" })).toBeChecked();
  expect(screen.getByLabelText("Daily window")).toHaveValue("22");
  expect(store.getState().game.speed).toBe("PAUSED");
  fireEvent.keyDown(
    screen.getByRole("heading", { name: "Time-of-use tariff" }),
    { key: "Escape" },
  );
  expect(
    screen.getByRole("region", { name: "Electricity pricing" }),
  ).toBeVisible();
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

test("remembers a hidden program's draft and scroll while releasing its clock pause", () => {
  jest.useFakeTimers();
  const game = { ...createGame({ scenarioId: 106 }), speed: "FAST" as const };
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
  });
  const memory = new Map<string, unknown>();
  const onClose = jest.fn();
  const content = (shown: boolean, cache = memory) => (
    <Provider store={store}>
      <GameToolMemoryContext.Provider value={cache}>
        {shown && <Programs onClose={onClose} />}
      </GameToolMemoryContext.Provider>
    </Provider>
  );
  const view = render(content(true));
  const overview = screen.getByRole("region", { name: "Customer programs" });
  fireEvent.scroll(overview, { target: { scrollTop: 180 } });
  fireEvent.click(
    screen.getByRole("button", { name: "Time-of-use tariff · Off" }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "On" }));
  fireEvent.change(screen.getByLabelText("Daily window"), {
    target: { value: "22" },
  });
  fireEvent.scroll(screen.getByRole("region", { name: "Program details" }), {
    target: { scrollTop: 95 },
  });
  expect(store.getState().game.speed).toBe("PAUSED");
  view.rerender(content(false));
  expect(store.getState().game.speed).toBe("FAST");
  view.rerender(content(true));
  expect(store.getState().game.speed).toBe("PAUSED");
  expect(screen.getByRole("radio", { name: "On" })).toBeChecked();
  expect(screen.getByLabelText("Daily window")).toHaveValue("22");
  expect(
    screen.getByRole("region", { name: "Program details" }).scrollTop,
  ).toBe(95);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("region", { name: "Customer programs" }).scrollTop,
  ).toBe(180);
  view.rerender(content(false));
  view.rerender(content(true, new Map()));
  expect(screen.queryByRole("region", { name: "Program details" })).toBeNull();
  expect(
    screen.getByRole("region", { name: "Customer programs" }).scrollTop,
  ).toBe(0);
});
