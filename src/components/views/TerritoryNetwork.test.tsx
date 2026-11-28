import { runMonths } from "../../testing/SimulationTestHelpers";
import userEvent from "@testing-library/user-event";
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
  territoryMapTileKey as mockTerritoryMapTileKey,
  territoryTileViews,
  type TerritoryMapTileKey,
  type TerritoryTileView,
} from "../../helpers/TerritoryMapState";
import * as territoryMapState from "../../helpers/TerritoryMapState";
import type { ReadyProjectSite } from "../../helpers/ProjectBuild";
import { currentTick } from "../../helpers/GameSelectors";
import {
  formatCount,
  formatPurchasePrice,
  formatWatts,
} from "../../helpers/Format";
import type { GameType, TerritoryTileId } from "../../Types";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import {
  MapWorkspacePanelContext,
  GameWorkspaceLayoutContext,
} from "../base/GameWorkspaceContext";
import { workspaceLayout } from "../../WorkspaceLayout";
import TerritoryNetwork from "./TerritoryNetwork";
import gameReducer, { buildFacility } from "../../reducers/Game";
import cardReducer from "../../reducers/Card";
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

jest.mock("../base/BuildForecast", () => {
  const forecast = {
    timeline: [],
    windSpeeds: [24],
    offshoreWindSpeeds: [],
    airborneWindSpeeds: [],
    solarIrradiances: [450],
  };
  return {
    useBuildForecast: (_game: unknown, enabled = true) =>
      enabled ? forecast : undefined,
  };
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
    selected?: TerritoryMapTileKey;
    onSelect: (key: TerritoryMapTileKey, activate?: boolean) => void;
    projectSites?: ReadonlyMap<TerritoryMapTileKey, ReadyProjectSite>;
    onProjectDrop?: (key: TerritoryMapTileKey) => void;
    onTileMenu: (anchor: {
      key: TerritoryMapTileKey;
      top: number;
      left: number;
    }) => void;
  }) => (
    <div aria-label="Tile map">
      <button className="territoryMapBuyToggle">Rapid connection mode</button>
      {props.views
        .filter(
          ({ tile, owned, connectable }) =>
            owned ||
            tile.city ||
            connectable ||
            mockTerritoryMapTileKey(tile) === props.selected,
        )
        .map(({ tile }) => {
          const key = mockTerritoryMapTileKey(tile);
          return (
            <button
              className="territoryTileTarget"
              tabIndex={props.selected === key ? 0 : -1}
              key={key}
              aria-pressed={props.selected === key}
              aria-label={`Inspect ${key}`}
              onFocus={() => props.onSelect(key)}
              onClick={() => props.onSelect(key, true)}
              onDrop={() => {
                if (props.projectSites?.has(key)) props.onProjectDrop?.(key);
              }}
              onContextMenu={() =>
                props.onTileMenu({ key, top: 100, left: 100 })
              }
            >
              {tile.terrain}
            </button>
          );
        })}
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
    reducer: { game: gameReducer, card: cardReducer, ui: uiReducer },
    preloadedState: { game },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false, immutableCheck: false }),
  });
  const facilityActions = {
    onSell: jest.fn(),
    onTogglePause: jest.fn(),
    onPause: jest.fn(),
    onRetrofit: jest.fn(),
    onExpand: jest.fn(),
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
          value={{ open, returnToMap: onInspect, projectRequested }}
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
async function openProjectPlanner(button: HTMLElement) {
  fireEvent.click(button);
  // Let the mocked lazy import settle and flush the Suspense retry before reading the panel.
  await act(async () => Promise.resolve());
}
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
    within(surface()).getByRole("button", { name: "Build here" }),
  ).toBeEnabled();
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
  fireEvent.click(
    within(surface()).getByRole("button", { name: "Build here" }),
  );
  const slider = within(surface()).getByRole("slider");
  act(() => slider.focus());
  fireEvent.change(slider, { target: { value: 9 } });
  expect(slider).toHaveFocus();
});

it("opens the locked catalogue from the compact inspector and switches between generators and storage", () => {
  const game = ready();
  const solar = GENERATORS(game, 30e6, [], []).find(
    (item) => item.name === "Solar",
  )!;
  const tile = availableTerritoryTiles(game, solar, "champlain")[0];
  show(game);
  inspect(tile.id);
  expect(surface()).toHaveClass("tileWorkspaceInspector");
  expect(within(surface()).queryByRole("tab")).not.toBeInTheDocument();
  expect(
    within(surface()).queryByRole("button", { name: "Close tile" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(surface()).getByRole("button", { name: "Build here" }),
  );
  expect(surface()).toHaveClass("tileWorkspaceBuilding");
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

it("builds on the activated tile and replaces the catalogue with the shared facility controls", async () => {
  const game = ready();
  const tile = freeTile(game);
  const { store } = show(game);
  inspect(tile.id);
  fireEvent.click(
    within(surface()).getByRole("button", { name: "Build here" }),
  );
  fireEvent.click(
    within(surface()).getByRole("button", { name: "Review purchase of Wind" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
  expect(
    store.getState().game.facilities.find((item) => item.tileId === tile.id),
  ).toMatchObject({ name: "Wind" });
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

it("starts construction on exactly the inspected tile and keeps building locked", () => {
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
  expect(surface()).toHaveTextContent(
    `Constructing transmission lines · ${quote.buildMonths} ${quote.buildMonths === 1 ? "month" : "months"} left`,
  );
  expect(
    within(surface()).getByRole("button", { name: "Build here" }),
  ).toBeDisabled();
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

it("shows purchased cities as customers rather than build destinations", async () => {
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
  for (
    let step = 0;
    step < 12 && !acquisitionQuote(game, target.territoryId);
    step++
  ) {
    const current = game;
    const next = territoryTileViews(current)
      .filter(({ tile }) => {
        const quote = tilePurchaseQuote(current, tile.id);
        return !tile.city && quote;
      })
      .sort((a, b) => distance(a.tile) - distance(b.tile))[0].tile;
    const quote = tilePurchaseQuote(game, next.id)!;
    game = gameReducer(
      game,
      acquireTile({ tileId: next.id, quoteKey: quote.quoteKey }),
    );
  }
  game = cloneDeep(game);
  runMonths(game, 2);
  const offer = acquisitionQuote(game, target.territoryId)!;
  expect(offer).toBeDefined();
  const { onAcquire, store } = show(game);
  onAcquire.mockImplementation((payload) => {
    store.dispatch(acquireUtility(payload));
    return true;
  });
  inspect(target.id);
  fireEvent.click(
    within(surface()).getByRole("button", {
      name: `Acquire (${formatPurchasePrice(offer.equityPrice)})`,
    }),
  );
  const review = screen.getByRole("dialog", { name: /^Acquire Vergennes/ });
  expect(
    within(review).queryByText("Sites transferred"),
  ).not.toBeInTheDocument();
  expect(
    within(within(review).getByLabelText("Operating plants")).getByText(
      "Natural Gas Peaker",
    ),
  ).toBeVisible();
  expect(within(review).getByText("Operating plants")).toBeVisible();
  fireEvent.click(within(review).getByText("Price breakdown"));
  expect(within(review).getByText("Vergennes service area")).toBeVisible();
  expect(within(review).getByText("Plant site")).toBeVisible();
  expect(within(review).getAllByText("Natural Gas Peaker")).toHaveLength(2);
  expect(ownsTerritoryTile(store.getState().game, target)).toBe(false);
  fireEvent.click(within(review).getByRole("button", { name: "Pay cash" }));
  await waitFor(() => expect(review).not.toBeInTheDocument());
  expect(
    screen.queryByRole("dialog", { name: "Acquisition unavailable" }),
  ).not.toBeInTheDocument();
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
  expect(
    within(surface()).getByText("Customers", { exact: true }),
  ).toBeVisible();
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

it("keeps fleet controls reachable after buying a utility", () => {
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
  const build = screen.getByRole("button", { name: "Build" });
  await openProjectPlanner(build);
  expect(
    screen.getByRole("heading", { name: "Project planner unavailable" }),
  ).toBeVisible();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByLabelText("Tile map")).toBeVisible();
  fireEvent.keyDown(surface(), { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mockProjectLoadFailure = false;
  await openProjectPlanner(build);
  expect(
    screen.getByLabelText("Pick site for Wind", {
      selector: "button",
    }),
  ).toBeEnabled();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(currentTick(store.getState().game)!.cash).toBe(cash);
  expect(store.getState().game.territoryNetwork!.tilePurchases).toHaveLength(0);
});

it.each([undefined, 1280])(
  "keeps the confirmed project locked when Build is activated during host Connect & build (%s)",
  async (width) => {
    const game = ready();
    game.multiplayer = { seat: "0" };
    const { store, requestProject, showPanel } = show(game, width);
    const commands: Command[] = [];
    registerMultiplayerRuntime({
      submit: async (command) => {
        commands.push(command);
      },
      command: jest.fn(),
      activity: jest.fn(),
      leave: async () => undefined,
    });
    await openProjectPlanner(screen.getByRole("button", { name: "Build" }));
    await openProjectPlanner(
      screen.getByLabelText(
        width ? "Choose sites for Wind" : "Pick site for Wind",
        { selector: "button" },
      ),
    );
    inspect("green-uplands:site-1");
    fireEvent.click(
      within(surface()).getByRole("button", { name: /^Connect & build ·/ }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    requestProject();
    inspect("champlain:site-13");
    fireEvent.keyDown(surface(), { key: "Escape" });
    showPanel(true);
    expect(within(surface()).getByText("Starting construction…")).toBeVisible();
    expect(
      within(surface()).getByRole("button", { name: /^Connect & build ·/ }),
    ).toBeDisabled();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wind · 20MW" })).toBeVisible();
    expect(commands).toHaveLength(1);
    expect(store.getState().game.facilities).toHaveLength(
      game.facilities.length,
    );
    const command = commands[0];
    if (command.kind !== "action" || command.name !== "buildFacility")
      throw new Error("Expected a combined construction command");
    act(() => {
      showPanel(false);
      store.dispatch(
        buildFacility(command.payload as Parameters<typeof buildFacility>[0]),
      );
    });
    expect(
      await screen.findByText(/Constructing transmission lines/),
    ).toBeVisible();
    expect(await screen.findByText(/Under construction .* left/)).toBeVisible();
    expect(
      within(surface()).queryByRole("button", { name: "Cash" }),
    ).not.toBeInTheDocument();
    expect(commands).toHaveLength(1);
  },
);

it("shows why an unavailable map technology cannot pick a site", async () => {
  const game = ready();
  currentTick(game)!.cash = 0;
  const { store } = show(game);
  await openProjectPlanner(screen.getByRole("button", { name: "Build" }));
  const pick = within(surface()).getByRole("button", {
    name: "Pick site for Offshore Wind",
  });
  expect(pick).toBeDisabled();
  expect(pick).toHaveAccessibleDescription(
    "No suitable sites currently available.",
  );
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
    within(surface()).queryByRole("region", { name: "Terrain modifiers" }),
  ).not.toBeInTheDocument();
  const wind = within(rail).getByRole("button", {
    name: "Choose sites for Wind",
  });
  await openProjectPlanner(wind);
  expect(wind).toHaveAttribute("aria-pressed", "true");
  expect(within(surface()).getByRole("button", { name: "Cash" })).toBeEnabled();
  expect(screen.getByRole("button", { name: `Inspect ${id}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(wind);
  expect(wind).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: `Inspect ${id}` })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await openProjectPlanner(wind);
  expect(wind).toHaveAttribute("aria-pressed", "true");
  expect(store.getState().game.facilities).toHaveLength(game.facilities.length);
  expect(currentTick(store.getState().game)!.cash).toBe(1e9);
});

it("only reviews a dragged project at the position resolved by its quote", async () => {
  const game = ready();
  const local = {
    id: "champlain:legacy-100",
    territoryId: "champlain",
    q: 20,
    r: -20,
    terrain: "plains",
    siteKind: "industrial",
    maxPeakW: 40e6,
  } as const;
  const peer = { ...local, q: 21 };
  game.territoryNetwork!.legacyTiles!.push(local);
  game.multiplayer = {
    seat: "host",
    legacyTiles: [{ tile: peer, seat: "guest", name: "Neighbor" }],
  };
  // The fixed board currently disallows connecting retained aliases. Exercise
  // the drop boundary with stale eligibility and the real company-local quote.
  const views = territoryTileViews(game).map((view) =>
    view.tile === peer ? { ...view, connectable: true } : view,
  );
  const stub = jest
    .spyOn(territoryMapState, "territoryMapBoard")
    .mockReturnValueOnce({ views, authoredInland: undefined });
  const { store } = show(game, 1280);
  stub.mockRestore();
  const wind = screen.getByRole("button", { name: "Choose sites for Wind" });
  const peerSite = screen.getByRole("button", {
    name: "Inspect retained:21:-20",
  });
  const localSite = screen.getByRole("button", {
    name: "Inspect retained:20:-20",
  });
  const dataTransfer = { setData: jest.fn() };
  expect(wind).toHaveAttribute("draggable", "true");

  fireEvent.dragStart(wind, { dataTransfer });
  fireEvent.drop(peerSite);
  await act(async () => Promise.resolve());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(localSite).toHaveAttribute("aria-pressed", "false");
  fireEvent.dragEnd(wind);

  fireEvent.dragStart(wind, { dataTransfer });
  fireEvent.drop(localSite);
  await act(async () => Promise.resolve());
  expect(localSite).toHaveAttribute("aria-pressed", "true");
  expect(within(surface()).getByRole("button", { name: "Cash" })).toBeEnabled();
  expect(store.getState().game.facilities).toEqual(game.facilities);
  expect(store.getState().game.territoryNetwork!.tilePurchases).toEqual(
    game.territoryNetwork!.tilePurchases,
  );
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
    await openProjectPlanner(screen.getByRole("button", { name: "Build" }));
    expect(
      within(surface()).getByRole("slider", { name: "Generator capacity" }),
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
  await openProjectPlanner(
    within(rail).getByRole("button", { name: "Choose sites for Solar" }),
  );
  inspect("champlain:site-13");
  const option = within(surface()).getByRole("checkbox", { name: /trackers/i });
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

it("keeps desktop upgrade editing out of the phone site review", async () => {
  const game = ready();
  game.date.year = 2025;
  game.startingYear = 2025;
  show(game, 390);
  await openProjectPlanner(screen.getByRole("button", { name: "Build" }));
  fireEvent.click(
    within(surface()).getByLabelText("Pick site for Solar", {
      selector: "button",
    }),
  );
  inspect("champlain:site-13");
  expect(within(surface()).getByRole("button", { name: "Cash" })).toBeEnabled();
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
    const useMaximum = within(
      screen.getByLabelText(`${name} technology preview`),
    ).getByRole("button", { name: shortcut });
    await openProjectPlanner(useMaximum);
    expect(screen.getByRole("button", { name: "Cash" })).toBeEnabled();
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

it("retains the inspected site while a desktop connection is being built", async () => {
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
  const inspector = within(surface());
  expect(
    inspector.getByText(/Constructing transmission lines/),
  ).not.toHaveAttribute("role");
  expect(
    inspector.getByRole("button", { name: "Build here" }),
  ).toHaveAccessibleDescription(/Constructing transmission lines.*0% complete/);
  expect(
    inspector.queryByRole("tab", { name: "Generators" }),
  ).not.toBeInTheDocument();
  await openProjectPlanner(
    screen.getByRole("button", { name: "Choose sites for Wind" }),
  );
  expect(within(surface()).getByRole("status")).toHaveTextContent(
    /Constructing transmission lines/,
  );
  expect(
    within(surface()).queryByRole("button", { name: "Cash" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: `Inspect ${site.id}` }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("takes facility actions from the map and confirms a sale of the same facility", () => {
  const game = ready();
  const facility = game.facilities.find(
    (item) =>
      item.tileId &&
      !item.saleRestricted &&
      !item.paused &&
      item.yearsToBuildLeft <= 0,
  )!;
  const { facilityActions } = show(game);
  const tile = screen.getByRole("button", {
    name: `Inspect ${facility.tileId}`,
  });
  fireEvent.contextMenu(tile);
  let menu = screen.getByRole("menu", { name: "Tile actions" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Pause" }));
  expect(facilityActions.onPause).toHaveBeenCalledWith(
    facility.id,
    facility.name,
  );
  expect(facilityActions.onSell).not.toHaveBeenCalled();

  fireEvent.contextMenu(tile);
  menu = screen.getByRole("menu", { name: "Tile actions" });
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Sell" }));
  const confirmation = screen.getByRole("dialog", { name: /^Sell:/ });
  expect(facilityActions.onSell).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Sell" }));
  expect(facilityActions.onSell).toHaveBeenCalledWith(facility.id);
});

it("keeps inspection available through primary activation", async () => {
  show();
  const tile = screen.getByRole("button", {
    name: "Inspect green-uplands:site-1",
  });
  act(() => tile.focus());
  fireEvent.contextMenu(tile);
  const actions = within(screen.getByRole("menu", { name: "Tile actions" }));
  expect(actions.getByRole("menuitem", { name: /^Connect/ })).toBeVisible();
  expect(
    actions.queryByRole("menuitem", { name: "Inspect" }),
  ).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  fireEvent.click(tile);
  expect(await screen.findByRole("heading", { name: "Forest" })).toHaveFocus();
});

function openConnectMenu(game: GameType, tileId: TerritoryTileId) {
  const { store } = show(game);
  const tile = screen.getByRole("button", { name: `Inspect ${tileId}` });
  act(() => tile.focus());
  fireEvent.contextMenu(tile);
  const menu = screen.getByRole("menu", { name: "Tile actions" });
  const connect = within(menu).getByRole("menuitem", { name: /^Connect/ });
  return { store, menu, connect };
}

it("lets keyboard players read the Connect shortfall without activating it", async () => {
  const game = ready();
  const tileId = "green-uplands:site-1";
  currentTick(game)!.cash = 1;
  const { store, menu, connect } = openConnectMenu(game, tileId);
  await userEvent.keyboard("{ArrowDown}");
  expect(connect).toHaveFocus();
  expect(connect).toHaveAttribute("aria-disabled", "true");
  expect(connect).toHaveAccessibleName(/more cash needed/);
  await userEvent.keyboard("{Enter}[Space]");
  expect(menu).toBeVisible();
  expect(ownsTerritoryTile(store.getState().game, tileId)).toBe(false);
  expect(currentTick(store.getState().game)!.cash).toBe(1);
});

it("connects an affordable tile from the keyboard", async () => {
  const game = ready();
  const tileId = "green-uplands:site-1";
  currentTick(game)!.cash = tilePurchaseQuote(game, tileId)!.price;
  const { store, connect } = openConnectMenu(game, tileId);
  await userEvent.keyboard("{ArrowDown}");
  expect(connect).toHaveFocus();
  expect(connect).not.toHaveAttribute("aria-disabled", "true");
  expect(connect).not.toHaveAccessibleName(/more cash needed/);
  await userEvent.keyboard("{Enter}");
  await waitFor(() =>
    expect(ownsTerritoryTile(store.getState().game, tileId)).toBe(true),
  );
});

it("opens the capacity upgrade directly from the tile actions", async () => {
  const game = ready();
  const facility = game.facilities.find(
    (item) => item.tileId && item.name === "Wind",
  )!;
  show(game);
  fireEvent.contextMenu(
    screen.getByRole("button", { name: `Inspect ${facility.tileId}` }),
  );
  const menu = screen.getByRole("menu", { name: "Tile actions" });
  fireEvent.click(
    within(menu).getByRole("menuitem", {
      name: "Upgrade capacity",
    }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Upgrade Wind capacity?" }),
  ).toBeVisible();
});
