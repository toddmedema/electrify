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
import { MapWorkspacePanelContext } from "../base/GameWorkspaceContext";
import TerritoryNetwork from "./TerritoryNetwork";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { GENERATORS } from "../../data/Facilities";
import { wToSliderTick } from "../../helpers/BuildSizing";
import { acquisitionQuote, transferUtility } from "../../helpers/Expansion";
import { acquireTile } from "../../reducers/GameActions";

jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);
// Keep this suite on the public selection/activation boundary; map geometry owns its own tests.
jest.mock("./TerritoryHexMap", () => ({
  __esModule: true,
  default: (props: {
    game: GameType;
    selected?: TerritoryTileId;
    onSelect: (id: TerritoryTileId, activate?: boolean) => void;
  }) => {
    const { territoryTileViews } = jest.requireActual<
      typeof import("../../helpers/TerritoryMapState")
    >("../../helpers/TerritoryMapState");
    return (
      <div aria-label="Tile map">
        <button className="territoryMapBuyToggle">Buy land</button>
        {territoryTileViews(props.game).map(({ tile }) => (
          <button
            className="territoryTileTarget"
            tabIndex={props.selected === tile.id ? 0 : -1}
            key={tile.id}
            aria-pressed={props.selected === tile.id}
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
  const onInspect = jest.fn();
  const content = (open = false) => (
    <Provider store={store}>
      <GameToolMemoryContext.Provider value={memory}>
        <MapWorkspacePanelContext.Provider value={{ open, inspect: onInspect }}>
          <Connected />
        </MapWorkspacePanelContext.Provider>
      </GameToolMemoryContext.Provider>
    </Provider>
  );
  const utils = render(content());
  return {
    store,
    facilityActions,
    onAcquire,
    onInspect,
    showPanel: (open: boolean) => utils.rerender(content(open)),
    ...utils,
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

it("keeps the map clear until activation, and deselects the tile when Escape closes inspection", () => {
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
  expect(screen.getByRole("button", { name: "Buy land" })).toHaveFocus();
  expect(tile).toHaveAttribute("aria-pressed", "false");
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
  expect(other).toHaveFocus();
  fireEvent.click(other);
  expect(
    within(surface()).getByRole("tab", { name: "Generators" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(within(surface()).getByRole("heading", { level: 3 })).toHaveFocus();
});

it("focuses every explicit activation, including another tile with the same heading", () => {
  const game = ready();
  const sites = territoryTileViews(game).filter(
    ({ tile, owned, facility }) => !owned && !tile.city && !facility,
  );
  const first = sites.find(({ tile }) =>
    sites.some(
      ({ tile: other }) =>
        other.id !== tile.id && other.terrain === tile.terrain,
    ),
  )!.tile;
  const second = sites.find(
    ({ tile }) => tile.id !== first.id && tile.terrain === first.terrain,
  )!.tile;
  show(game);
  inspect(first.id);
  const heading = within(surface()).getByRole("heading", { level: 3 });
  const title = heading.textContent;
  const other = screen.getByRole("button", { name: `Inspect ${second.id}` });
  act(() => other.focus());
  expect(other).toHaveFocus();
  fireEvent.click(other);
  expect(heading).toHaveTextContent(title!);
  expect(heading).toHaveFocus();
  act(() => other.focus());
  fireEvent.click(other);
  expect(heading).toHaveFocus();
  inspect(freeTile(game).id);
  const slider = within(surface()).getByRole("slider");
  act(() => slider.focus());
  fireEvent.change(slider, { target: { value: 9 } });
  expect(slider).toHaveFocus();
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
  expect(within(surface()).getByRole("heading", { level: 3 })).toHaveFocus();
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

it.each([
  "valley-electric:city",
  "ridge-electric:city",
  "parcel-1:city",
] as const)("shows a demand profile before owning %s", (id) => {
  const game = ready();
  show(game);
  inspect(id);
  expect(surface()).toHaveTextContent("Estimated demand");
  expect(
    within(surface()).getByRole("img", {
      name: /predicted electricity demand by customer or use type/,
    }),
  ).toHaveAccessibleName(/Residential:/);
  expect(surface()).not.toHaveTextContent(
    /Build a generator or storage|construction is purchased separately|general construction/,
  );
});

it("shows researched terrain effects before purchase, with speed labelled separately from output", () => {
  const game = ready();
  const forest = territoryTileViews(game).find(
    ({ tile, owned }) => !owned && !tile.city && tile.terrain === "forest",
  )!.tile;
  show(game);
  inspect(forest.id);
  const effects = within(surface()).getByRole("region", {
    name: "Terrain modifiers",
  });
  expect(effects).toHaveTextContent("Wind speed−5%");
  expect(effects).toHaveTextContent("Wind build cost+5%");
  expect(effects).toHaveTextContent("Solar build cost+5%");
  expect(surface()).not.toHaveTextContent(
    /MW max|Build a generator or storage|general construction/,
  );
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
  const buy = within(surface()).getByRole("button", { name: /Buy tile/ });
  act(() => buy.focus());
  fireEvent.click(buy);
  expect(currentTick(store.getState().game)!.cash).toBe(before - quote.price);
  expect(ownsTerritoryTile(store.getState().game, tile.id)).toBe(true);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    within(surface()).getByRole("tab", { name: "Generators" }),
  ).toHaveAttribute("aria-selected", "true");
  expect(within(surface()).getByRole("heading", { level: 3 })).toHaveFocus();
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
  let game = ready();
  const target = territoryTileViews(game).find(
    ({ tile, owned, ownerKey }) => !!tile.city && !owned && !ownerKey,
  )!.tile;
  const distance = (tile: typeof target) =>
    Math.max(
      Math.abs(tile.q - target.q),
      Math.abs(tile.r - target.r),
      Math.abs(tile.q + tile.r - target.q - target.r),
    );
  for (let step = 0; step < 12 && !tilePurchaseQuote(game, target.id); step++) {
    const current = game;
    const next = territoryTileViews(current)
      .filter(({ tile }) => !tile.city && !!tilePurchaseQuote(current, tile.id))
      .sort((a, b) => distance(a.tile) - distance(b.tile))[0].tile;
    const quote = tilePurchaseQuote(game, next.id)!;
    game = gameReducer(
      game,
      acquireTile({ tileId: next.id, quoteKey: quote.quoteKey }),
    );
  }
  expect(tilePurchaseQuote(game, target.id)).toBeDefined();
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

it("replaces tile inspection with a dock panel, without resurrecting the old inspector", () => {
  const app = show();
  inspect("champlain:city");
  expect(surface()).toBeVisible();
  expect(app.onInspect).toHaveBeenCalledTimes(1);
  app.showPanel(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Inspect champlain:city" }),
  ).toHaveAttribute("aria-pressed", "false");
  app.showPanel(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  inspect("champlain:city");
  expect(surface()).toBeVisible();
  expect(app.onInspect).toHaveBeenCalledTimes(2);
});
