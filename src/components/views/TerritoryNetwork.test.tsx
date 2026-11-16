import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";
import { createGame } from "../../testing/Simulator";
import {
  tilePurchaseQuote,
  territoryDemandShares,
} from "../../helpers/Territories";
import {
  availableTerritoryTiles,
  ownsTerritoryTile,
} from "../../helpers/TerritoryTiles";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts } from "../../helpers/Format";
import type { GameType, TerritoryTileId } from "../../Types";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import TerritoryNetwork from "./TerritoryNetwork";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { GENERATORS } from "../../data/Facilities";
import { wToSliderTick } from "../../helpers/BuildSizing";
import { acquisitionQuote, transferUtility } from "../../helpers/Expansion";

jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);
// Keep this suite on the public selection/activation boundary; map geometry owns its own tests.
jest.mock("./TerritoryHexMap", () => ({
  __esModule: true,
  default: (props: {
    game: GameType;
    selected: TerritoryTileId;
    onSelect: (id: TerritoryTileId, activate?: boolean) => void;
  }) => {
    const { territoryTileViews } = jest.requireActual<
      typeof import("../../helpers/TerritoryMapState")
    >("../../helpers/TerritoryMapState");
    return (
      <div aria-label="Tile map">
        {territoryTileViews(props.game).map(({ tile }) => (
          <button
            className="territoryTileTarget"
            tabIndex={props.selected === tile.id ? 0 : -1}
            key={tile.id}
            aria-label={`Inspect ${tile.id}`}
            onFocus={() => props.onSelect(tile.id)}
            onClick={() => props.onSelect(tile.id, true)}
          >
            {tile.terrain}
          </button>
        ))}
      </div>
    );
  },
}));

function ready() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  return game;
}
function show(game = ready()) {
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }),
  });
  const facilityActions = {
    onSell: jest.fn(),
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
    onRetrofit: jest.fn(),
    onCancelRetrofit: jest.fn(),
  };
  const memory = new Map<string, unknown>([
    ["generators.size", wToSliderTick(30e6)],
    ["storage.size", wToSliderTick(100e6)],
  ]);
  const onAcquire = jest.fn();
  function Connected() {
    const state = useSelector((state: { game: GameType }) => state.game);
    return (
      <TerritoryNetwork
        game={state}
        facilityActions={facilityActions}
        onBuild={jest.fn()}
        onUpgrade={jest.fn()}
        onAcquire={onAcquire}
        onBuyingRule={jest.fn()}
        onSellingRule={jest.fn()}
      />
    );
  }
  return {
    store,
    facilityActions,
    onAcquire,
    ...render(
      <Provider store={store}>
        <GameToolMemoryContext.Provider value={memory}>
          <Connected />
        </GameToolMemoryContext.Provider>
      </Provider>,
    ),
  };
}
const inspect = (id: TerritoryTileId) =>
  fireEvent.click(screen.getByRole("button", { name: `Inspect ${id}` }));
const surface = () => screen.getByRole("dialog");
function freeTile(game: GameType) {
  const wind = GENERATORS(game, 30e6, [], []).find(
    (item) => item.name === "Wind",
  )!;
  return availableTerritoryTiles(game, wind, "champlain")[0];
}

it("keeps the map clear until activation, and closes to the same map tile with Escape", () => {
  const game = ready();
  show(game);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const tile = screen.getByRole("button", { name: "Inspect champlain:city" });
  act(() => tile.focus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(tile);
  expect(surface()).not.toHaveAttribute("aria-modal", "true");
  expect(within(surface()).getByRole("heading", { level: 3 })).toHaveFocus();
  fireEvent.keyDown(surface(), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(tile).toHaveFocus();
  expect(
    screen.queryByText(/company power pool|one project per tile|Territories$/i),
  ).not.toBeInTheDocument();
});

it("keeps inspection on its activated tile while map focus moves", () => {
  const game = ready();
  show(game);
  inspect("champlain:city");
  const other = screen.getByRole("button", {
    name: `Inspect ${freeTile(game).id}`,
  });
  act(() => other.focus());
  expect(
    within(surface()).getByRole("heading", { level: 3 }),
  ).toHaveTextContent("Residential city");
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
  fireEvent.click(other);
  expect(
    within(surface()).getByRole("tab", { name: "Generators" }),
  ).toHaveAttribute("aria-selected", "true");
});

it("opens the actual locked catalogue immediately and switches between generators and storage", () => {
  const game = ready();
  const solar = GENERATORS(game, 30e6, [], []).find(
    (item) => item.name === "Solar",
  )!;
  const tile = availableTerritoryTiles(game, solar, "champlain")[0];
  show(game);
  inspect(tile.id);
  expect(
    within(surface()).getByRole("tab", { name: "Generators" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    within(surface()).queryByRole("combobox", {
      name: /Build destination|Build tile/,
    }),
  ).not.toBeInTheDocument();
  expect(
    within(surface()).getByRole("button", { name: "Review purchase of Solar" }),
  ).toBeEnabled();
  fireEvent.click(within(surface()).getByRole("tab", { name: "Storage" }));
  expect(
    within(surface()).getByRole("tab", { name: "Storage" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(within(surface()).getByRole("slider")).toBeInTheDocument();
  expect(
    within(surface()).queryByRole("combobox", {
      name: /Build destination|Build tile/,
    }),
  ).not.toBeInTheDocument();
});

it("builds on the activated tile and replaces the catalogue with the shared facility controls", () => {
  const game = ready();
  const tile = freeTile(game);
  const { store } = show(game);
  inspect(tile.id);
  fireEvent.click(
    within(surface()).getByRole("button", { name: "Review purchase of Wind" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  expect(
    store.getState().game.facilities.find((item) => item.tileId === tile.id),
  ).toMatchObject({ name: "Wind" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    within(surface()).getByRole("button", {
      name: /Cancel construction of Wind/,
    }),
  ).toBeEnabled();
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
});

it("shows the same expanded plant controls and sale review used by fleet rows", () => {
  const game = ready();
  const plant = game.facilities[0];
  const { facilityActions } = show(game);
  inspect(plant.tileId!);
  expect(
    within(surface()).queryByRole("button", { name: "Inspect plant" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(surface()).getByRole("button", { name: `Pause ${plant.name}` }),
  );
  expect(facilityActions.onPause).toHaveBeenCalledWith(plant.id, plant.name);
  fireEvent.click(
    within(surface()).getByRole("button", { name: `Sell ${plant.name}` }),
  );
  expect(screen.getByRole("button", { name: "Sell" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Sell" }));
  expect(facilityActions.onSell).toHaveBeenCalledWith(plant.id);
});

it("shows the city's real sector demand in the existing demand-by-use chart", () => {
  const game = ready();
  show(game);
  inspect("champlain:city");
  expect(surface()).toHaveTextContent("Connected customers");
  expect(surface()).toHaveTextContent(
    formatWatts(territoryDemandShares(game, currentTick(game)!)["champlain"]),
  );
  expect(
    within(surface()).getByRole("img", {
      name: /predicted electricity demand by customer or use type/,
    }),
  ).toBeInTheDocument();
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
});

it("buys exactly the inspected tile in one action and shows its build catalogue", () => {
  const game = ready();
  const tile = territoryTileViews(game).find(
    ({ tile }) => !tile.city && tilePurchaseQuote(game, tile.id),
  )!.tile;
  const quote = tilePurchaseQuote(game, tile.id)!;
  const before = currentTick(game)!.cash;
  const { store } = show(game);
  inspect(tile.id);
  expect(surface()).toHaveTextContent("Cash after purchase");
  fireEvent.click(within(surface()).getByRole("button", { name: /Buy tile/ }));
  expect(currentTick(store.getState().game)!.cash).toBe(before - quote.price);
  expect(ownsTerritoryTile(store.getState().game, tile.id)).toBe(true);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    within(surface()).getByRole("tab", { name: "Generators" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(1);
});

it("keeps unaffordable tiles inspectable without spending", () => {
  const game = ready();
  const tile = territoryTileViews(game).find(({ tile }) =>
    tilePurchaseQuote(game, tile.id),
  )!.tile;
  currentTick(game)!.cash = 1;
  const { store } = show(game);
  inspect(tile.id);
  expect(
    within(surface()).getByRole("button", { name: /Buy tile/ }),
  ).toBeDisabled();
  expect(within(surface()).getByRole("status")).toHaveTextContent(
    "more cash needed",
  );
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
});

it("reveals purchased cities as customers rather than build destinations", () => {
  const game = ready();
  const target = territoryTileViews(game).find(
    ({ tile }) => !!tile.city && !!tilePurchaseQuote(game, tile.id),
  )!.tile;
  show(game);
  inspect(target.id);
  fireEvent.click(within(surface()).getByRole("button", { name: /Buy tile/ }));
  expect(surface()).toHaveTextContent("Connected customers");
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
});

it("keeps acquisition receipts and fleet controls reachable after buying a utility", () => {
  const game = ready();
  const quote = acquisitionQuote(game, "ridge-electric")!;
  transferUtility(game, {
    targetId: "ridge-electric",
    financed: false,
    quoteKey: quote.quoteKey,
  });
  const plant = game.facilities.find(
    (item) => item.territoryId === "ridge-electric",
  )!;
  show(game);
  inspect(plant.tileId!);
  expect(
    within(surface()).getByRole("button", { name: `Pause ${plant.name}` }),
  ).toBeEnabled();
  expect(screen.getByText("Acquired utilities (1)")).toBeInTheDocument();
});
