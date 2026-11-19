import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { wToSliderTick } from "../../helpers/BuildSizing";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import { createGame } from "../../testing/Simulator";
import { registerMultiplayerRuntime } from "../../multiplayer/Registry";
import cardReducer from "../../reducers/Card";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import BuildGeneratorsContainer from "./BuildGeneratorsContainer";
import BuildStorageContainer from "./BuildStorageContainer";

jest.mock("../base/BuildForecast", () => ({
  useBuildForecast: () => undefined,
}));
jest.mock("../base/useWorkerRequest", () => ({
  useWorkerRequest: () => ({ status: "idle" }),
}));

afterEach(() => registerMultiplayerRuntime(undefined));

it.each([
  ["Natural Gas Peaker", BuildGeneratorsContainer],
  ["Lithium Battery", BuildStorageContainer],
] as const)(
  "keeps the connected %s purchase review open after host rejection",
  async (label, Catalogue) => {
    const game = createGame({ scenarioId: 100, seed: 611 });
    game.timeline[0].cash = 1e12;
    game.multiplayer = { seat: "0" };
    const store = configureStore({
      reducer: { game: gameReducer, card: cardReducer, ui: uiReducer },
      preloadedState: { game },
      middleware: (defaults) =>
        defaults({ serializableCheck: false, immutableCheck: false }),
    });
    const reason = "The host declined this order.";
    const submit = jest.fn().mockRejectedValue(new Error(reason));
    registerMultiplayerRuntime({
      submit,
      command: jest.fn(),
      activity: jest.fn(),
      leave: async () => undefined,
    });

    const memory = new Map<string, unknown>([
      ["storage.size", wToSliderTick(10e6)],
    ]);
    render(
      <Provider store={store}>
        <GameToolMemoryContext.Provider value={memory}>
          <Catalogue />
        </GameToolMemoryContext.Provider>
      </Provider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Review purchase of ${label}` }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Pay cash" }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(await within(dialog).findByText(reason)).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Pay cash" }),
    ).toBeEnabled();
  },
);
