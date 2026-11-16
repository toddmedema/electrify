import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createGame } from "../../testing/Simulator";
import {
  landPurchaseQuote,
  purchaseLand,
  territoryDemandShares,
} from "../../helpers/Territories";
import {
  facilityOnTile,
  getTerritoryTiles,
} from "../../helpers/TerritoryTiles";
import { currentTick } from "../../helpers/GameSelectors";
import { LAND_TERRITORIES } from "../../data/Territories";
import { formatFacilitySize, formatWatts } from "../../helpers/Format";
import type { GameType, TerritoryId, TerritoryTileId } from "../../Types";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import {
  TERRITORY_BUILD_MEMORY_KEY,
  TERRITORY_TILE_BUILD_MEMORY_KEY,
} from "../base/TerritoryBuildDestination";
import { territoryMapLabel } from "../base/TerritoryMapLayout";
import TerritoryNetwork from "./TerritoryNetwork";
import { acquisitionQuote, transferUtility } from "../../helpers/Expansion";

jest.mock("../base/useOutlookWorker", () => ({
  useOutlookWorker: () => undefined,
}));
jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);
// Map geometry and artwork have their own suite. Exercise the detail pane through its
// public tile selection callback, including the distinction between navigation and inspection.
jest.mock("./TerritoryHexMap", () => ({
  __esModule: true,
  default: (props: {
    game: GameType;
    selected: TerritoryTileId;
    onSelect: (id: TerritoryTileId, inspect?: boolean) => void;
  }) => {
    const { getTerritoryTiles } = jest.requireActual<
      typeof import("../../helpers/TerritoryTiles")
    >("../../helpers/TerritoryTiles");
    return (
      <div aria-label="Tile map">
        {getTerritoryTiles(props.game).map((tile) => (
          <button
            key={tile.id}
            aria-label={`Inspect ${tile.id}`}
            aria-pressed={props.selected === tile.id}
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
const controls = {
  onBuild: jest.fn(),
  onUpgrade: jest.fn(),
  onBuyingRule: jest.fn(),
  onSellingRule: jest.fn(),
};
function show(
  game: ReturnType<typeof ready>,
  initialTile: TerritoryTileId = "champlain:city",
) {
  const store = configureStore({ reducer: { game: () => game } });
  const onBuildFacility = jest.fn();
  const onInspectFacility = jest.fn();
  const memory = new Map<string, unknown>([["network.tile", initialTile]]);
  return {
    onBuildFacility,
    onInspectFacility,
    memory,
    ...render(
      <Provider store={store}>
        <GameToolMemoryContext.Provider value={memory}>
          <TerritoryNetwork
            game={game}
            {...controls}
            onAcquire={jest.fn()}
            onBuildFacility={onBuildFacility}
            onInspectFacility={onInspectFacility}
          />
        </GameToolMemoryContext.Provider>
      </Provider>,
    ),
  };
}
const detail = () => screen.getByRole("region", { name: "Selected territory" });
const inspect = (id: TerritoryTileId) =>
  fireEvent.click(screen.getByRole("button", { name: `Inspect ${id}` }));
const firstTile = (game: GameType, id: TerritoryId) =>
  getTerritoryTiles(game).find((tile) => tile.territoryId === id)!;
function buy(game: GameType, id: Parameters<typeof landPurchaseQuote>[1]) {
  const quote = landPurchaseQuote(game, id)!;
  expect(
    purchaseLand(game, { territoryId: id, quoteKey: quote.quoteKey }),
  ).toBe(true);
}

it("shows one residential city with its existing company demand and no building slot", () => {
  const game = ready();
  show(game);
  expect(within(detail()).getByRole("heading", { level: 3 })).toHaveTextContent(
    "Plains · Residential city",
  );
  expect(detail()).toHaveTextContent("Current demand");
  expect(detail()).toHaveTextContent(
    formatWatts(territoryDemandShares(game, currentTick(game)!)["champlain"]),
  );
  expect(detail()).toHaveTextContent("No building slot");
  expect(
    within(detail()).queryByRole("button", { name: /Build|Storage/ }),
  ).not.toBeInTheDocument();
});

it.each(LAND_TERRITORIES)(
  "reviews unowned $benefit parcel $id as a cash purchase from its tile",
  ({ id, benefit }) => {
    const game = ready();
    show(game, firstTile(game, id).id);
    fireEvent.click(
      within(detail()).getByRole("button", { name: /Buy territory/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Buy territory" });
    expect(
      within(dialog).getByRole("button", { name: /Buy territory/ }),
    ).toBeEnabled();
    expect(
      within(dialog).queryByRole("button", { name: /loan/i }),
    ).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      benefit === "residential"
        ? "residential customers"
        : benefit === "industrial"
          ? "industrial customers"
          : benefit === "general"
            ? "shared building sites"
            : `${benefit} development site`,
    );
  },
);

it("quotes both tiles in a neutral parcel as the same purchase with all its rights", () => {
  const game = ready();
  const tiles = getTerritoryTiles(game).filter(
    (tile) => tile.territoryId === "parcel-0",
  );
  show(game, tiles[0].id);
  const firstPrice = within(detail()).getByRole("button", {
    name: /Buy territory/,
  }).textContent;
  inspect(tiles[1].id);
  expect(
    within(detail()).getByRole("button", { name: /Buy territory/ }),
  ).toHaveTextContent(firstPrice!);
  fireEvent.click(
    within(detail()).getByRole("button", { name: /Buy territory/ }),
  );
  expect(
    screen.getByRole("dialog", { name: "Buy territory" }),
  ).toHaveTextContent("2 shared building sites");
});

it("reviews an unaffordable parcel with its benefits and cash shortfall", () => {
  const game = ready();
  currentTick(game)!.cash = 1;
  show(game, "parcel-1:city");
  fireEvent.click(
    within(detail()).getByRole("button", { name: /Buy territory/ }),
  );
  const dialog = screen.getByRole("dialog", { name: "Buy territory" });
  expect(
    within(dialog).getByRole("button", { name: /Buy territory/ }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "more cash needed",
  );
  expect(dialog).toHaveTextContent("residential customers");
});

it.each(["green-uplands", "parcel-0", "parcel-7", "parcel-3"] as const)(
  "remembers the exact free tile and parent destination when building in %s",
  (id) => {
    const game = ready();
    buy(game, id);
    const tile = firstTile(game, id);
    const { onBuildFacility, memory } = show(game, tile.id);
    expect(detail()).toHaveTextContent("1 / 1 available");
    expect(detail()).toHaveTextContent(
      `${formatWatts(tile.maxPeakW!)} / project`,
    );
    fireEvent.click(within(detail()).getByRole("button", { name: /^Build/ }));
    expect(onBuildFacility).toHaveBeenCalledWith(id, false);
    expect(memory.get(TERRITORY_BUILD_MEMORY_KEY)).toBe(id);
    expect(memory.get(TERRITORY_TILE_BUILD_MEMORY_KEY)).toBe(tile.id);
    expect(game.transmission!.lines).toEqual([]);
  },
);

it("selects storage for a single compatible slot and preserves its exact tile", () => {
  const game = ready();
  buy(game, "parcel-0");
  const tile = getTerritoryTiles(game).filter(
    (item) => item.territoryId === "parcel-0",
  )[1];
  const { onBuildFacility, memory } = show(game, tile.id);
  fireEvent.click(within(detail()).getByRole("button", { name: "Storage" }));
  expect(onBuildFacility).toHaveBeenCalledWith("parcel-0", true);
  expect(memory.get(TERRITORY_TILE_BUILD_MEMORY_KEY)).toBe(tile.id);
});

it("shows an acquired industrial city without offering plant sites", () => {
  const game = ready();
  buy(game, "parcel-5");
  show(game, "parcel-5:city");
  expect(detail()).toHaveTextContent("Connected customersIndustrial400");
  expect(detail()).toHaveTextContent("Current demand");
  expect(
    within(detail()).queryByRole("button", { name: /Build|Storage/ }),
  ).not.toBeInTheDocument();
});

it("shows a single occupied plant and opens its fleet inspection instead of another build", () => {
  const game = ready();
  const plant = game.facilities[0];
  const { onInspectFacility } = show(game, plant.tileId!);
  expect(detail()).toHaveTextContent(formatFacilitySize(plant));
  expect(detail()).toHaveTextContent("Building slot occupied");
  expect(
    within(detail()).queryByRole("button", { name: /Build|Storage/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(detail()).getByRole("button", { name: "Inspect plant" }),
  );
  expect(onInspectFacility).toHaveBeenCalledWith(plant.id);
});

it("keeps paused construction on its occupied tile with its remaining build time", () => {
  const game = ready();
  const plant = game.facilities[0];
  plant.yearsToBuildLeft = 0.5;
  plant.paused = true;
  show(game, plant.tileId!);
  expect(detail()).toHaveTextContent("Construction paused · 6 months left");
  expect(
    within(detail()).queryByRole("button", { name: /^Build/ }),
  ).not.toBeInTheDocument();
});

it.each(["ridge-electric", "valley-electric"] as const)(
  "offers the unchanged %s acquisition and terms from an occupied utility tile",
  (id) => {
    const game = ready();
    const tile = getTerritoryTiles(game).find(
      (item) => item.territoryId === id && item.startingAssetId,
    )!;
    show(game, tile.id);
    expect(detail()).toHaveTextContent("Building slot occupied");
    fireEvent.click(
      within(detail()).getByRole("button", {
        name: `Acquire ${territoryMapLabel(id)}`,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: `Acquire ${territoryMapLabel(id)}?` }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(
      within(detail()).getByRole("button", {
        name: `Inspect ${territoryMapLabel(id)}`,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "Acquisition terms" }),
    ).toBeVisible();
  },
);

it("shows only the acquired utility tile's facility after ownership transfers", () => {
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
  show(game, plant.tileId!);
  expect(detail()).toHaveTextContent("Your territory");
  expect(
    within(detail()).getByRole("button", { name: "Inspect plant" }),
  ).toBeEnabled();
  expect(
    within(detail()).queryByRole("button", { name: /^Acquire|^Build/ }),
  ).not.toBeInTheDocument();
});

it("disables only the parcel owned by another co-op company", () => {
  const game = ready();
  game.multiplayer = {
    seat: "0",
    landOwners: { "parcel-7": { seat: "1", name: "North Electric" } },
  };
  show(game, "parcel-7:site-0");
  expect(detail()).toHaveTextContent("Owned by North Electric");
  expect(
    within(detail()).getByRole("button", { name: /Buy territory/ }),
  ).toBeDisabled();
  inspect("parcel-3:site-0");
  expect(
    within(detail()).getByRole("button", { name: /Buy territory/ }),
  ).toBeEnabled();
});

it("shows terrain wind and construction facts only when they affect the selected site", () => {
  const game = ready();
  buy(game, "green-uplands");
  const tiles = getTerritoryTiles(game).filter(
    (tile) => tile.territoryId === "green-uplands",
  );
  show(game, tiles.find((tile) => tile.terrain === "hills")!.id);
  expect(detail()).toHaveTextContent("Onshore wind speed+10%");
  expect(detail()).toHaveTextContent("Wind / solar build cost+10%");
  inspect(tiles.find((tile) => tile.terrain === "plains")!.id);
  expect(detail()).not.toHaveTextContent("Onshore wind speed");
  expect(detail()).not.toHaveTextContent("build cost");
});

it("shows a peer storage occupant without applying wind or solar terrain modifiers", () => {
  const game = ready();
  const tile = getTerritoryTiles(game).find(
    (item) => item.territoryId === "green-uplands" && item.terrain === "hills",
  )!;
  game.multiplayer = {
    seat: "0",
    landOwners: { "green-uplands": { seat: "1", name: "North Electric" } },
    tileFacilities: {
      [tile.id]: {
        seat: "1",
        name: "Battery",
        peakW: 20e6,
        peakWh: 80e6,
        yearsToBuildLeft: 0,
      },
    },
  };
  show(game, tile.id);
  expect(within(detail()).getByRole("heading", { level: 3 })).toHaveTextContent(
    "Hills · Battery",
  );
  expect(detail()).toHaveTextContent("80MWh");
  expect(detail()).toHaveTextContent("Power20MW");
  expect(detail()).not.toHaveTextContent("wind speed");
  expect(detail()).not.toHaveTextContent(/build cost/i);
  expect(
    within(detail()).queryByRole("button", {
      name: /Build|Storage|Inspect plant/,
    }),
  ).not.toBeInTheDocument();
});

it("restricts the ocean tile to offshore wind and offers no storage", () => {
  const game = ready();
  const tile = getTerritoryTiles(game).find(
    (item) => item.terrain === "ocean" && item.territoryId === "champlain",
  )!;
  expect(facilityOnTile(game, tile.id)).toBeUndefined();
  show(game, tile.id);
  expect(detail()).toHaveTextContent("Accepts offshore wind");
  expect(
    within(detail()).getByRole("button", { name: /^Build/ }),
  ).toBeEnabled();
  expect(
    within(detail()).queryByRole("button", { name: "Storage" }),
  ).not.toBeInTheDocument();
});

it.each([false, true])(
  "remembers tile navigation and hands inspection focus to the detail (narrow: %s)",
  async (narrow) => {
    const media = jest.spyOn(window, "matchMedia").mockReturnValue({
      ...window.matchMedia("(max-width: 740px)"),
      matches: narrow,
    });
    try {
      const { memory } = show(ready());
      const scroll = jest.fn();
      Object.defineProperty(detail(), "scrollIntoView", { value: scroll });
      const target = screen.getByRole("button", {
        name: "Inspect parcel-0:site-1",
      });
      act(() => target.focus());
      expect(memory.get("network.tile")).toBe("parcel-0:site-1");
      expect(target).toHaveFocus();
      expect(scroll).not.toHaveBeenCalled();
      fireEvent.click(target);
      await waitFor(() =>
        expect(
          within(detail()).getByRole("heading", { level: 3 }),
        ).toHaveFocus(),
      );
      expect(scroll.mock.calls).toEqual(narrow ? [[{ block: "start" }]] : []);
    } finally {
      media.mockRestore();
    }
  },
);

it("keeps later tile navigation focused when an inspection frame is pending", () => {
  jest.useFakeTimers();
  try {
    show(ready());
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect champlain:city" }),
    );
    const next = screen.getByRole("button", {
      name: "Inspect champlain:site-0",
    });
    act(() => next.focus());
    act(() => jest.advanceTimersByTime(32));
    expect(next).toHaveFocus();
  } finally {
    jest.useRealTimers();
  }
});
