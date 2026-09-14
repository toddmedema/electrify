import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import cardReducer, { initialCard } from "../../reducers/Card";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import BuildFacilities from "./BuildFacilities";

jest.mock("./BuildGeneratorsContainer", () => () => (
  <div>Generator catalog</div>
));
jest.mock("./BuildStorageContainer", () => () => <div>Storage catalog</div>);

function setup() {
  const game = createGame({ scenarioId: 103 });
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
  fireEvent.click(screen.getByRole("tab", { name: "Interties" }));
  expect(screen.getByRole("tabpanel", { name: "Interties" })).toHaveTextContent(
    "No intertie projects are available in this region.",
  );
  expect(store.getState().card.history).toHaveLength(1);
  expect(window.history.length).toBe(browserHistoryLength);
  fireEvent.click(screen.getByRole("button", { name: "close" }));
  expect(store.getState().card.name).toBe("FACILITIES");
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
