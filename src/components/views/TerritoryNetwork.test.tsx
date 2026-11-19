import * as React from "react";
import cloneDeep from "lodash.clonedeep";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useSelector } from "react-redux";
import { createGame } from "../../testing/Simulator";
import {
  tilePurchaseQuote,
  territoryDemandShares,
} from "../../helpers/Territories";
import {
  availableTerritoryTiles,
  getTerritoryTile,
  ownsTerritoryTile,
  territoryTilePowerLimit,
} from "../../helpers/TerritoryTiles";
import {
  territoryTileViews,
  type TerritoryTileView,
} from "../../helpers/TerritoryMapState";
import { currentTick } from "../../helpers/GameSelectors";
import { formatCount, formatWatts } from "../../helpers/Format";
import type { GameType, TerritoryTileId } from "../../Types";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import {
  MapWorkspacePanelContext,
  GameWorkspaceLayoutContext,
} from "../base/GameWorkspaceContext";
import { workspaceLayout } from "../../WorkspaceLayout";
import TerritoryNetwork from "./TerritoryNetwork";
import gameReducer, { buildFacility } from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { GENERATORS } from "../../data/Facilities";
import { wToSliderTick } from "../../helpers/BuildSizing";
import { getHydroAvailability } from "../../data/HydroSites";
import { acquisitionQuote, transferUtility } from "../../helpers/Expansion";
import { acquireTile, acquireUtility } from "../../reducers/GameActions";
import { registerMultiplayerRuntime } from "../../multiplayer/Registry";
import type { Command } from "../../multiplayer/Types";

let mockProjectLoadFailure = false;
afterEach(() => {
  registerMultiplayerRuntime(undefined);
  mockProjectLoadFailure = false;
});

jest.mock("../base/ProjectBuild", () => {
  if (mockProjectLoadFailure) throw new Error("Project chunk unavailable");
  return jest.requireActual("../base/ProjectBuild");
});

jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);
// Keep this suite on the public selection/activation boundary; map geometry owns its own tests.
jest.mock("./TerritoryHexMap", () => ({
  __esModule: true,
  default: (props: {
    views: readonly TerritoryTileView[];
    selected?: TerritoryTileId;
    onSelect: (id: TerritoryTileId, activate?: boolean) => void;
  }) => (
    <div aria-label="Tile map">
      <button className="territoryMapBuyToggle">Rapid connection mode</button>
      {props.views
        .filter(
          ({ tile, owned, connectable }) =>
            owned || tile.city || connectable || tile.id === props.selected,
        )
        .map(({ tile }) => (
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
  ),
}));

let opening: GameType | undefined;
function ready() {
  opening ??= createGame({ scenarioId: 116, seed: 188 });
  const game = cloneDeep(opening);
  currentTick(game)!.cash = 1e9;
  return game;
}
function show(game = ready(), width?: number, scale = 1) {
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
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
  let projectRequested = false;
  const openProject = () => {
    if (projectRequested) utils.rerender(content());
    projectRequested = true;
    utils.rerender(content(false, true));
  };
  const content = (open = false, projectRequested = false) => (
    <Provider store={store}>
      <GameToolMemoryContext.Provider value={memory}>
        <MapWorkspacePanelContext.Provider
          value={{ open, inspect: onInspect, projectRequested }}
        >
          <GameWorkspaceLayoutContext.Provider
            value={
              width
                ? {
                    ...workspaceLayout(width, scale, "automatic"),
                    fleetVisible: true,
                  }
                : undefined
            }
          >
            <button onClick={openProject}>Build</button>
            <Connected />
          </GameWorkspaceLayoutContext.Provider>
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
    requestProject: () => {
      openProject();
    },
    ...utils,
  };
}
const inspect = (id: TerritoryTileId) =>
  fireEvent.click(
    screen.getByLabelText(`Inspect ${id}`, { selector: "button" }),
  );
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
  expect(
    screen.getByRole("button", { name: "Rapid connection mode" }),
  ).toHaveFocus();
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
  ).toHaveTextContent("Burlington");
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
    ({ tile, connectable, facility }) => connectable && !tile.city && !facility,
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
  expect(surface()).toHaveTextContent("Opening customers");
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
    ({ tile, connectable }) => connectable && tile.terrain === "forest",
  )!.tile;
  show(game);
  inspect(forest.id);
  const effects = within(surface()).getByRole("region", {
    name: "Terrain modifiers",
  });
  expect(effects).toHaveTextContent("−5% wind speed");
  expect(effects).toHaveTextContent("+5% build cost");
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
  expect(surface()).not.toHaveTextContent("Cash after connection");
  const buy = within(surface()).getByRole("button", { name: /Connect/ });
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
    within(surface()).getByRole("button", { name: /Connect/ }),
  ).toBeDisabled();
  expect(within(surface()).getByRole("status")).toHaveTextContent(
    "more cash needed",
  );
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
});

it("shows purchased cities as customers rather than build destinations", () => {
  let game = ready();
  const target = territoryTileViews(game).find(
    ({ tile }) => tile.id === "parcel-1:city",
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
      .filter(({ tile }) => {
        const quote = tilePurchaseQuote(current, tile.id);
        return !tile.city && quote && !quote.utilityName;
      })
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
  fireEvent.click(
    within(surface()).getByRole("button", { name: /Acquire utility/ }),
  );
  expect(surface()).toHaveTextContent("Customers transferred");
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
});

it("shows the same grown customer count before and after a delayed utility acquisition", () => {
  const game = ready();
  game.date.minute += 5 * 365 * 24 * 60;
  game.date.monthsElapsed += 60;
  game.date.year += 5;
  currentTick(game)!.cash = 1e12;
  const quote = acquisitionQuote(game, "ridge-electric")!;
  const app = show(game);
  inspect("ridge-electric:city");
  expect(surface()).toHaveTextContent("Customers to connect");
  expect(surface()).toHaveTextContent(formatCount(quote.customers));
  act(() =>
    app.store.dispatch(
      acquireUtility({
        targetId: quote.targetId,
        financed: false,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
  expect(surface()).toHaveTextContent("Customers transferred");
  expect(surface()).toHaveTextContent(formatCount(quote.customers));
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

it("keeps a failed planner load in one closable panel and retries on the next opening", async () => {
  mockProjectLoadFailure = true;
  const { store } = show();
  const cash = currentTick(store.getState().game)!.cash;
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
  expect(
    await screen.findByRole("heading", { name: "Project planner unavailable" }),
  ).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByLabelText("Tile map")).toBeVisible();
  fireEvent.keyDown(surface(), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mockProjectLoadFailure = false;
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
  expect(
    await screen.findByLabelText("Choose sites for Wind", {
      selector: "button",
    }),
  ).toBeEnabled();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(currentTick(store.getState().game)!.cash).toBe(cash);
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
});

it.each([undefined, 1280])(
  "keeps the confirmed project locked when Build is activated during host Connect (%s)",
  async (width) => {
    const game = ready();
    game.multiplayer = { seat: "0" };
    const { store, requestProject, showPanel } = show(game, width);
    const commands: Command[] = [];
    registerMultiplayerRuntime({
      submit: async (command) => {
        commands.push(command);
        if (command.kind === "action" && command.name === "buildFacility")
          store.dispatch(
            buildFacility(
              command.payload as Parameters<typeof buildFacility>[0],
            ),
          );
      },
      command: jest.fn(),
      activity: jest.fn(),
      leave: async () => undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    fireEvent.click(
      await screen.findByLabelText("Choose sites for Wind", {
        selector: "button",
      }),
    );
    inspect("green-uplands:site-1");
    fireEvent.click(await screen.findByRole("button", { name: "Cash" }));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    requestProject();
    inspect("champlain:site-13");
    fireEvent.keyDown(surface(), { key: "Escape" });
    showPanel(true);
    expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Connect and build Wind?" }),
    ).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(store.getState().game.facilities).toHaveLength(
      game.facilities.length,
    );
    const connect = commands[0];
    if (connect.kind !== "action" || connect.name !== "acquireTile")
      throw new Error("Expected connection command");
    act(() => {
      store.dispatch(
        acquireTile(connect.payload as Parameters<typeof acquireTile>[0]),
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(commands).toHaveLength(2);
    expect(
      store
        .getState()
        .game.facilities.find(
          ({ tileId }) => tileId === "green-uplands:site-1",
        ),
    ).toMatchObject({ name: "Wind", peakW: 20e6 });
  },
);

it("explains when a project has no compatible highlighted sites without requiring connection or cash", async () => {
  const game = ready();
  currentTick(game)!.cash = 0;
  const { store } = show(game);
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Choose sites for Offshore Wind",
    }),
  );
  expect(
    screen.getByText(/No compatible connected or adjacent sites/),
  ).toBeVisible();
  expect(
    screen.queryByText("Choose a highlighted site."),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change project" })).toBeEnabled();
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
  expect(currentTick(store.getState().game)!.cash).toBe(0);
});

it("uses the persistent desktop rail for Build and owned empty tiles, preselecting that site without spending", async () => {
  const game = ready();
  const { store } = show(game, 1280);
  const rail = screen.getByRole("complementary", { name: "Build facilities" });
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
  expect(rail).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const id = freeTile(game).id;
  inspect(id);
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
  expect(
    within(surface()).getByRole("region", { name: "Terrain modifiers" }),
  ).toBeVisible();
  fireEvent.click(
    within(rail).getByRole("button", { name: "Choose sites for Wind" }),
  );
  expect(await screen.findByRole("button", { name: "Cash" })).toBeEnabled();
  expect(screen.getByRole("button", { name: `Inspect ${id}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
  expect(currentTick(store.getState().game)!.cash).toBe(1e9);
});

it.each([
  [1023, 1],
  [1280, 1.5],
  [390, 1],
  [360, 1],
])(
  "retains the catalogue below 1024 effective pixels (%s px at %s scale)",
  async (width, scale) => {
    show(ready(), width, scale);
    expect(
      screen.queryByRole("complementary", { name: "Build facilities" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(
      await screen.findByRole("slider", { name: "Generator capacity" }),
    ).toBeInTheDocument();
  },
);

it("keeps a candidate and canonical quote when generator upgrades change, then locks editing during host build", async () => {
  const game = ready();
  game.date.year = 2025;
  game.startingYear = 2025;
  game.multiplayer = { seat: "0" };
  const { store } = show(game, 1280);
  let finishBuild: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finishBuild = resolve;
  });
  const commands: Command[] = [];
  registerMultiplayerRuntime({
    submit: async (command) => {
      commands.push(command);
      await pending;
      if (command.kind === "action" && command.name === "buildFacility")
        store.dispatch(
          buildFacility(command.payload as Parameters<typeof buildFacility>[0]),
        );
    },
    command: jest.fn(),
    activity: jest.fn(),
    leave: async () => undefined,
  });
  const rail = screen.getByRole("complementary", { name: "Build facilities" });
  fireEvent.click(
    within(rail).getByRole("button", { name: "Choose sites for Solar" }),
  );
  inspect("champlain:site-13");
  const option = await screen.findByRole("checkbox", { name: /trackers/i });
  const selected = screen.getByRole("button", {
    name: "Inspect champlain:site-13",
  });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(option).not.toBeChecked();
  fireEvent.click(option);
  expect(option).toBeChecked();
  expect(selected).toHaveAttribute("aria-pressed", "true");
  const cash = screen.getByRole("button", { name: "Cash" });
  expect(cash).toBeEnabled();
  fireEvent.click(cash);
  expect(option).toBeDisabled();
  fireEvent.click(option);
  inspect("champlain:site-12");
  fireEvent.click(
    within(rail).getByRole("button", { name: "Choose sites for Wind" }),
  );
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(option).toBeChecked();
  expect(commands).toHaveLength(1);
  await act(async () => finishBuild());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    store
      .getState()
      .game.facilities.find(({ tileId }) => tileId === "champlain:site-13"),
  ).toMatchObject({ name: "Solar" });
});

it("keeps the phone project sheet unchanged without desktop upgrade editing", async () => {
  const game = ready();
  game.date.year = 2025;
  game.startingYear = 2025;
  show(game, 390);
  fireEvent.click(screen.getByRole("button", { name: "Build" }));
  fireEvent.click(
    await screen.findByLabelText("Choose sites for Solar", {
      selector: "button",
    }),
  );
  inspect("champlain:site-13");
  expect(await screen.findByRole("button", { name: "Cash" })).toBeEnabled();
  expect(
    screen.queryByRole("checkbox", { name: /trackers/i }),
  ).not.toBeInTheDocument();
});

it.each([
  ["Hydro", "parcel-7:site-0", "Use site maximum"],
  ["Geothermal", "parcel-3:site-0", "Use max size"],
] as const)(
  "retains an inspected owned %s site when its oversized rail preview chooses the exact site maximum",
  async (name, siteId, shortcut) => {
    const game = ready();
    (game.territoryNetwork!.tilePurchases ??= []).push({
      tileId: siteId,
      minute: game.date.minute,
      price: 0,
    });
    const maximum =
      name === "Hydro"
        ? getHydroAvailability(game, 8e7, "parcel-7", siteId).largest!.maxPeakW
        : territoryTilePowerLimit(getTerritoryTile(siteId, game)!);
    const { store } = show(game, 1280);
    inspect(siteId);
    fireEvent.click(screen.getByRole("button", { name: /Power:/ }));
    fireEvent.change(
      screen.getByRole("slider", { name: "Generator capacity" }),
      {
        target: { value: wToSliderTick(8e7) },
      },
    );
    fireEvent.keyDown(
      screen.getByRole("slider", { name: "Generator capacity" }),
      { key: "Escape" },
    );
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: `Choose sites for ${name}` }),
    );
    fireEvent.click(
      within(screen.getByLabelText(`${name} technology preview`)).getByRole(
        "button",
        { name: shortcut },
      ),
    );
    expect(await screen.findByRole("button", { name: "Cash" })).toBeEnabled();
    expect(
      screen.getByRole("heading", {
        name: `${name} · ${formatWatts(maximum)}`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Inspect ${siteId}` }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(currentTick(store.getState().game)!.cash).toBe(1e9);
    expect(store.getState().game.facilities).toHaveLength(
      game.facilities.length,
    );
  },
);

it("retains the inspected site when connecting transitions directly into desktop construction", async () => {
  const game = ready();
  const site = territoryTileViews(game).find(
    ({ tile }) =>
      !tile.city &&
      tile.terrain === "forest" &&
      tilePurchaseQuote(game, tile.id),
  )!.tile;
  const { store } = show(game, 1280);
  inspect(site.id);
  fireEvent.click(within(surface()).getByRole("button", { name: /Connect/ }));
  expect(ownsTerritoryTile(store.getState().game, site.id)).toBe(true);
  expect(
    within(surface()).queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Choose sites for Wind" }),
  );
  expect(await screen.findByRole("button", { name: "Cash" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: `Inspect ${site.id}` }),
  ).toHaveAttribute("aria-pressed", "true");
});
