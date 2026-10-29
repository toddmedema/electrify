import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import cardReducer, { initialCard } from "../../reducers/Card";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import BuildFacilities from "./BuildFacilities";

jest.mock("./BuildGeneratorsContainer", () => () => (
  <div>
    Generator catalog
    <div className="constructionHeader">
      <div
        className="constructionControls"
        role="group"
        aria-label="Capacity controls"
      >
        <input type="range" aria-label="Capacity" />
      </div>
    </div>
  </div>
));
jest.mock("./BuildStorageContainer", () => () => <div>Storage catalog</div>);
jest.mock("./TransmissionPanel", () => () => <div>Intertie catalog</div>);

function setup(scenarioId = 103, tutorialStep = 0, isolated = true) {
  const game = createGame({ scenarioId });
  game.tutorialStep = tutorialStep;
  if (isolated)
    game.location = { ...game.location, id: "HNL", name: "Honolulu, HI" };
  const store = configureStore({
    reducer: { game: () => game, card: cardReducer, ui: uiReducer },
    preloadedState: {
      card: {
        ...initialCard,
        name: "BUILD_GENERATORS" as const,
        history: ["FACILITIES" as const],
      },
    },
  });
  render(
    <Provider store={store}>
      <BuildFacilities />
    </Provider>,
  );
  return store;
}

it("shares one build screen, defaults to generators and keeps tab changes out of navigation history", () => {
  const store = setup();
  expect(screen.getByRole("tab", { name: "Generators" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getAllByRole("button", { name: "close" })).toHaveLength(1);
  expect(
    screen.getByRole("tabpanel", { name: "Generators" }),
  ).toHaveTextContent("Generator catalog");
  const browserHistoryLength = window.history.length;
  fireEvent.click(screen.getByRole("tab", { name: "Storage" }));
  expect(screen.getByRole("tabpanel", { name: "Storage" })).toHaveTextContent(
    "Storage catalog",
  );
  // Honolulu has no neighboring markets, so there is no empty Interties tab to visit.
  expect(screen.queryByRole("tab", { name: "Interties" })).toBeNull();
  expect(store.getState().card.history).toHaveLength(1);
  expect(window.history.length).toBe(browserHistoryLength);
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  expect(store.getState().card.name).toBe("FACILITIES");
});

function swipe(target: Element, dx: number, dy = 0) {
  const touch = { identifier: 1, clientX: 200, clientY: 100 };
  fireEvent.touchStart(target, { touches: [touch] });
  const end = {
    ...touch,
    clientX: touch.clientX + dx,
    clientY: touch.clientY + dy,
  };
  fireEvent.touchMove(target, { touches: [end] });
  fireEvent.touchEnd(target, { touches: [], changedTouches: [end] });
}

it("swipes through the available categories in either direction without wrapping or adding history", () => {
  const store = setup(103, 0, false);
  const panel = () => screen.getByRole("tabpanel");
  swipe(panel(), 100);
  expect(panel()).toHaveAccessibleName("Generators");
  swipe(panel(), -100);
  expect(panel()).toHaveAccessibleName("Storage");
  swipe(panel(), -100);
  expect(panel()).toHaveAccessibleName("Interties");
  swipe(panel(), -100);
  expect(panel()).toHaveAccessibleName("Interties");
  swipe(panel(), 100);
  expect(panel()).toHaveAccessibleName("Storage");
  swipe(panel(), 100);
  expect(panel()).toHaveAccessibleName("Generators");
  expect(store.getState().card.history).toHaveLength(1);
});

it("leaves sliders, their control area, vertical scrolls, short drags and cancelled gestures alone", () => {
  setup();
  const panel = screen.getByRole("tabpanel");
  swipe(screen.getByRole("slider"), -100);
  swipe(screen.getByRole("group", { name: "Capacity controls" }), -100);
  swipe(panel, -25);
  swipe(panel, -100, 150);
  fireEvent.touchStart(panel, {
    touches: [{ identifier: 1, clientX: 200, clientY: 100 }],
  });
  fireEvent.touchCancel(panel);
  fireEvent.touchEnd(panel, {
    touches: [],
    changedTouches: [{ identifier: 1, clientX: 0, clientY: 100 }],
  });
  expect(panel).toHaveAccessibleName("Generators");
  swipe(panel, -100);
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Storage");
  swipe(screen.getByRole("tabpanel"), -100);
  expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Storage");
});

it("supports standard keyboard navigation between build tabs", async () => {
  setup();
  const user = userEvent.setup({ delay: null });
  act(() => screen.getByRole("tab", { name: "Generators" }).focus());
  await user.keyboard("{ArrowRight}{Enter}");
  expect(screen.getByRole("tab", { name: "Storage" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "Storage" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it.each([1, 2])(
  "hides build categories while sorting or reviewing Mission 2 generator choices at step %s",
  (step) => {
    setup(1, step);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getByRole("tabpanel", { name: "Generators" }),
    ).toHaveTextContent("Generator catalog");
  },
);
