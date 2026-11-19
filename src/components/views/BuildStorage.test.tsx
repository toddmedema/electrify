import {
  act,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import { GameType, isStorage } from "../../Types";
import BuildStorage from "./BuildStorage";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import { purchaseTerms } from "../../helpers/Financials";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { availableTerritoryTiles } from "../../helpers/TerritoryTiles";
import {
  getAuthoredTerritoryTile,
  TERRITORY_TILES,
} from "../../data/TerritoryTiles";
import { wToSliderTick } from "../../helpers/BuildSizing";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import {
  TERRITORY_BUILD_MEMORY_KEY,
  TERRITORY_TILE_BUILD_MEMORY_KEY,
  territoryBuildTileName,
} from "../base/TerritoryBuildDestination";

jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);

it.each([false, true])(
  "prices and builds the same physical tile when selected automatically: %p",
  (automatic) => {
    const game = createGame({ scenarioId: 116, seed: 611 });
    game.date.year = 2020;
    game.timeline[0].cash = 1e12;
    const battery = STORAGE(game, 100e6).find(
      (candidate) => candidate.name === "Battery",
    )!;
    const territory = "green-uplands";
    const tile = TERRITORY_TILES.find(
      ({ territoryId, terrain }) =>
        territoryId === territory && terrain === "forest",
    )!;
    game.territoryNetwork!.tilePurchases = [
      { tileId: tile.id, minute: 0, price: 3e6 },
    ];
    expect(availableTerritoryTiles(game, battery, territory)).toEqual([tile]);
    const memory = new Map<string, unknown>([
      [TERRITORY_BUILD_MEMORY_KEY, territory],
      ["storage.size", wToSliderTick(100e6)],
    ]);
    if (!automatic) memory.set(TERRITORY_TILE_BUILD_MEMORY_KEY, tile.id);
    const onBuild = jest.fn();
    render(
      <GameToolMemoryContext.Provider value={memory}>
        <BuildStorage game={game} onBack={jest.fn()} onBuildStorage={onBuild} />
      </GameToolMemoryContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Review purchase of Lithium Battery",
      }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      territoryBuildTileName(tile.id, game, battery),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
    expect(onBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Battery",
        peakWh: 100e6,
        buildCost: battery.buildCost * 1.05,
      }),
      false,
      territory,
      tile.id,
    );
  },
);

it.each([false, true])(
  "resizes an unaffordable battery to the largest affordable slider size (live cash: %s)",
  (live) => {
    const state = game();
    state.date.year = 2020;
    const quote = (size: number) =>
      STORAGE(state, size).find((item) => item.name === "Battery")!;
    const cash = purchaseTerms(
      quote(70e6).buildCost,
      true,
      state.interestRate,
    ).downpayment;
    const cashAt = (amount: number) => ({
      ...state,
      timeline: state.timeline.map((tick) => ({ ...tick, cash: amount })),
    });
    const store = configureStore({
      reducer: {
        game: (
          state = cashAt(live ? 0 : cash),
          action: { type: string; payload?: typeof state },
        ) => (action.type === "replace" ? action.payload! : state),
      },
    });
    const onBuildStorage = jest.fn();
    const catalog = (
      <BuildStorage
        game={store.getState().game}
        onBuildStorage={onBuildStorage}
        onBack={jest.fn()}
      />
    );
    render(live ? <Provider store={store}>{catalog}</Provider> : catalog);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "18" } });
    const review = screen.getByRole("button", {
      name: "Review purchase of Lithium Battery",
    });
    expect(review).toBeDisabled();
    const card = screen.getByText(
      (_text, element) =>
        element?.getAttribute("data-build-option") === "Lithium Battery",
    );
    const useMax = () =>
      within(card).queryByRole("button", { name: "Use max size" });
    expect(Boolean(useMax())).toBe(!live);
    const updateCash = (amount: number) =>
      act(() => {
        store.dispatch({ type: "replace", payload: cashAt(amount) });
      });
    const smallerCash = purchaseTerms(
      quote(60e6).buildCost,
      true,
      state.interestRate,
    ).downpayment;
    updateCash(smallerCash);
    expect(useMax()).toBeInTheDocument();
    updateCash(0);
    expect(Boolean(useMax())).toBe(!live);
    updateCash(smallerCash);
    // Both sizes remain below the Review threshold, so the click must read current cash.
    updateCash(cash);
    fireEvent.click(within(card).getByRole("button", { name: "Use max size" }));
    expect(review).toBeEnabled();
    fireEvent.click(review);
    fireEvent.click(screen.getByRole("button", { name: "Take loan" }));
    expect(onBuildStorage.mock.calls[0][0].peakWh).toBe(70e6);
  },
);

it("keeps storage affordability and its open review current independently of the quote", () => {
  const initial = {
    ...createGame({ scenarioId: 100, seed: 12345 }),
    speed: "FAST" as const,
  };
  const cashAt = (cash: number) => ({
    ...initial,
    timeline: initial.timeline.map((tick) => ({ ...tick, cash })),
  });
  const store = configureStore({
    reducer: {
      game: (
        state = cashAt(0),
        action: { type: string; payload?: typeof initial },
      ) => (action.type === "replace" ? action.payload! : state),
    },
  });
  render(
    <Provider store={store}>
      <BuildStorage
        game={store.getState().game}
        onBack={jest.fn()}
        onBuildStorage={jest.fn()}
      />
    </Provider>,
  );
  const review = screen.getByRole("button", {
    name: "Review purchase of Pumped Hydro",
  });
  expect(review).toBeDisabled();
  act(() => {
    store.dispatch({ type: "replace", payload: cashAt(1e12) });
  });
  expect(review).toBeEnabled();
  fireEvent.click(review);
  expect(screen.getByRole("button", { name: "Pay cash" })).toBeEnabled();
  act(() => {
    store.dispatch({ type: "replace", payload: cashAt(0) });
  });
  expect(screen.getByRole("button", { name: "Pay cash" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Take loan" })).toBeDisabled();
});

function game(): GameType {
  const state = createGame({ scenarioId: 103 });
  return {
    ...state,
    location: {
      id: "Reykjavik",
      name: "Reykjavik, Iceland",
      lat: 64.1466,
      long: -21.9426,
      country: "Iceland",
      region: "Europe",
    },
  };
}

it("shows remaining pumped-hydro locations in the expanded build view", () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Show Pumped Hydro details" }),
  );

  const row = screen.getByRole("row", {
    name: /Sites left.*648/,
  });
  expect(row).toHaveTextContent("648");
});

it("submits a storage purchase only once on a double-click", () => {
  const onBuildStorage = jest.fn();
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={onBuildStorage}
      onBack={jest.fn()}
    />,
  );

  // Pumped Hydro is the first shopping card, so its price is the first purchase button.
  fireEvent.click(
    screen.getAllByRole("button", { name: /^Review purchase of/ })[0],
  );
  const takeLoan = screen.getByRole("button", { name: "Take loan" });
  fireEvent.click(takeLoan);
  fireEvent.click(takeLoan);

  expect(onBuildStorage).toHaveBeenCalledTimes(1);
});

it("deduplicates storage purchase impact and shows loan terms below the payment", async () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  fireEvent.click(
    screen.getAllByRole("button", { name: /^Review purchase of/ })[0],
  );

  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent(/Loan option.* \+ .*\/mo/);
  expect(impact).toHaveTextContent("Estimated upkeep");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).toHaveTextContent(/New loan: \d+\.\d+% for 30 years\./);
  expect(impact).not.toHaveTextContent("Loan:");
  expect(screen.queryByText("Cash cost")).not.toBeInTheDocument();
  expect(screen.queryByText("Time to build")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("table", { name: "Financing terms" }),
  ).not.toBeInTheDocument();

  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "close" }));
  await waitForElementToBeRemoved(dialog);
});

it("offers an oversized storage project its max size", () => {
  // Batteries exist by 2020 but can't yet reach the slider's largest size
  const state = game();
  render(
    <BuildStorage
      game={{ ...state, date: { ...state.date, year: 2020 } }}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );
  const slider = screen.getByRole("slider");
  fireEvent.keyDown(slider, { key: "End" });
  expect(
    screen.getByRole("button", { name: "Review purchase of Lithium Battery" }),
  ).toBeDisabled();
  const battery = screen.getByText(
    (_text, element) =>
      element?.getAttribute("data-build-option") === "Lithium Battery",
  );
  const useMaxSize = within(battery).getByRole("button", {
    name: "Use max size",
  });

  const before = slider.getAttribute("aria-valuenow");
  fireEvent.click(useMaxSize);
  expect(slider).not.toHaveAttribute("aria-valuenow", before!);
  expect(
    within(battery).queryByRole("button", { name: "Use max size" }),
  ).not.toBeInTheDocument();
});

it("opens at average storage energy capacity", () => {
  const state = game();
  const storage = createGame({ scenarioId: 2 }).facilities.find(isStorage)!;
  state.facilities = [400e6, 800e6].map((peakWh, index) => ({
    ...storage,
    id: index + 1,
    peakWh,
  }));
  render(
    <BuildStorage game={state} onBack={jest.fn()} onBuildStorage={jest.fn()} />,
  );
  expect(screen.getByRole("slider")).toHaveAccessibleName(/600MWh/);
});

it("shows lithium and iron-air efficiency before opening details", () => {
  const state = createGame({ scenarioId: 100 });
  state.date.year = 2030;
  render(
    <BuildStorage game={state} onBack={jest.fn()} onBuildStorage={jest.fn()} />,
  );
  expect(screen.getByText("Fast response, four hours of power")).toBeVisible();
  expect(screen.queryByText("Energy capacity")).not.toBeInTheDocument();
  expect(screen.getByText("85%")).toBeVisible();
  expect(screen.getByText("43%")).toBeVisible();
  for (const name of ["Lithium Battery", "Iron-Air Battery"]) {
    expect(
      screen.getByRole("button", { name: `Show ${name} details` }),
    ).toHaveAttribute("aria-expanded", "false");
  }
  fireEvent.click(
    screen.getByRole("button", { name: "Show Lithium Battery details" }),
  );
  const table = screen.getByRole("table", { name: "storage properties" });
  expect(
    within(table).queryByRole("row", { name: /Efficiency/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Lithium Battery" }),
  );
  expect(screen.getByRole("dialog")).toHaveAccessibleName(/Lithium Battery/);
});

it("locks storage to its activated tile without destination pickers", () => {
  const game = createGame({ scenarioId: 116, seed: 611 });
  game.date.year = 2020;
  game.timeline[0].cash = 1e12;
  const battery = STORAGE(game, 100e6).find(
    (candidate) => candidate.name === "Battery",
  )!;
  const tile = availableTerritoryTiles(game, battery, "champlain")[0];
  const memory = new Map<string, unknown>([
    [TERRITORY_BUILD_MEMORY_KEY, "green-uplands"],
    [TERRITORY_TILE_BUILD_MEMORY_KEY, "green-uplands:site-0"],
    ["storage.size", wToSliderTick(100e6)],
  ]);
  const onBuild = jest.fn();
  render(
    <GameToolMemoryContext.Provider value={memory}>
      <BuildStorage
        game={game}
        lockedTileId={tile.id}
        onBack={jest.fn()}
        onBuildStorage={onBuild}
      />
    </GameToolMemoryContext.Provider>,
  );
  expect(
    screen.queryByRole("combobox", { name: "Build destination" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Build tile" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Lithium Battery" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    territoryBuildTileName(tile.id, game, battery),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay cash" }));
  expect(onBuild).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Battery", peakWh: 100e6 }),
    false,
    "champlain",
    tile.id,
  );
});

it("puts buildable storage first for every sort while retaining oversized compatible cards", () => {
  const game = createGame({ scenarioId: 116, seed: 611 });
  game.date.year = 2030;
  game.timeline[0].cash = 1e12;
  game.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  render(
    <GameToolMemoryContext.Provider
      value={
        new Map<string, unknown>([
          ["storage.size", wToSliderTick(1e9)],
          ["storage.exactSizes", { Battery: 6e9 }],
        ])
      }
    >
      <BuildStorage
        game={game}
        lockedTileId="green-uplands:site-0"
        onBack={jest.fn()}
        onBuildStorage={jest.fn()}
      />
    </GameToolMemoryContext.Provider>,
  );
  for (const order of ["Build cost", "Build time"]) {
    fireEvent.click(screen.getByRole("button", { name: /^Sort facilities:/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: order }));
    const reviews = screen.getAllByRole<HTMLButtonElement>("button", {
      name: /^Review purchase of/,
    });
    const enabled = reviews.filter((review) => !review.disabled);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.length).toBeLessThan(reviews.length);
    expect(reviews.slice(0, enabled.length)).toEqual(enabled);
  }
  const battery = screen
    .getAllByRole("listitem")
    .find(
      (card) => card.getAttribute("data-build-option") === "Lithium Battery",
    )!;
  expect(
    within(battery).getByRole("button", { name: "Use max size" }),
  ).toBeEnabled();
  expect(
    within(battery).getByRole("button", {
      name: "Show Lithium Battery details",
    }),
  ).toBeEnabled();
  expect(battery).not.toHaveTextContent("Not buildable on this tile");
  expect(screen.queryByText(/Infinity|∞/)).not.toBeInTheDocument();
});

it("offers full storage reviews on ordinary wind land", () => {
  const game = createGame({ scenarioId: 116, seed: 611 });
  game.date.year = 2030;
  game.timeline[0].cash = 1e12;
  const wind = GENERATORS(game, 1e6, [], []).find(
    (facility) => facility.fuel === "Wind",
  )!;
  const tile = availableTerritoryTiles(game, wind, "champlain").find(
    (tile) => tile.siteKind === "wind",
  )!;
  render(
    <BuildStorage
      game={game}
      lockedTileId={tile.id}
      onBack={jest.fn()}
      onBuildStorage={jest.fn()}
    />,
  );
  const cards = screen
    .getAllByRole("listitem")
    .filter((card) => card.hasAttribute("data-build-option"));
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(
      within(card).getByRole("button", { name: /^Review purchase of/ }),
    ).toBeEnabled();
    expect(within(card).getByText("Build cost")).toBeVisible();
  }
});

it("reduces lake-forbidden storage technologies to an icon, name and explanation", () => {
  const game = createGame({ scenarioId: 116, seed: 611 });
  game.date.year = 2030;
  game.timeline[0].cash = 1e12;
  const tile = getAuthoredTerritoryTile("champlain:site-14")!;
  expect(tile.terrain).toBe("lake");
  render(
    <BuildStorage
      game={game}
      lockedTileId={tile.id}
      onBack={jest.fn()}
      onBuildStorage={jest.fn()}
    />,
  );
  const cards = screen
    .getAllByRole("listitem")
    .filter((card) => card.hasAttribute("data-build-option"));
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(card).toHaveTextContent("Not buildable on this tile");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(within(card).queryByText("Build cost")).not.toBeInTheDocument();
  }
});

it("updates storage order when live cash crosses a purchase threshold", () => {
  const state = {
    ...createGame({ scenarioId: 100, seed: 611 }),
    speed: "FAST" as const,
  };
  state.date.year = 2030;
  const size = 100e6;
  const quote = STORAGE(state, size).find(
    (storage) => storage.name === "Iron-Air Battery",
  )!;
  const cash = purchaseTerms(
    quote.buildCost,
    true,
    state.interestRate,
  ).downpayment;
  const cashAt = (amount: number) => ({
    ...state,
    timeline: state.timeline.map((tick) => ({ ...tick, cash: amount })),
  });
  const store = configureStore({
    reducer: {
      game: (
        game = cashAt(0),
        action: { type: string; payload?: typeof state },
      ) => (action.type === "replace" ? action.payload! : game),
    },
  });
  render(
    <Provider store={store}>
      <GameToolMemoryContext.Provider
        value={
          new Map<string, unknown>([
            ["storage.size", wToSliderTick(size)],
            ["storage.sort", "yearsToBuild"],
          ])
        }
      >
        <BuildStorage
          game={store.getState().game}
          onBack={jest.fn()}
          onBuildStorage={jest.fn()}
        />
      </GameToolMemoryContext.Provider>
    </Provider>,
  );
  const before = screen.getAllByRole("button", {
    name: /^Review purchase of/,
  })[0];
  expect(before).toBeDisabled();
  act(() => {
    store.dispatch({ type: "replace", payload: cashAt(cash) });
  });
  const reviews = screen.getAllByRole<HTMLButtonElement>("button", {
    name: /^Review purchase of/,
  });
  const enabled = reviews.filter((review) => !review.disabled);
  expect(enabled.length).toBeGreaterThan(0);
  expect(reviews.slice(0, enabled.length)).toEqual(enabled);
  expect(reviews[0]).not.toBe(before);
});
