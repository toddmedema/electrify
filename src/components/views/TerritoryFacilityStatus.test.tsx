import * as React from "react";
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import gameReducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import { GameType, isStorage, TerritoryTileId } from "../../Types";
import { GameToolMemoryContext } from "../base/GameToolMemory";
import TerritoryNetwork from "./TerritoryNetwork";

jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);

beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});
afterEach(() => jest.restoreAllMocks());

function ready() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const facility = game.facilities.find((facility) => facility.tileId)!;
  facility.yearsToBuildLeft = 0;
  facility.currentW = 20e6;
  facility.paused = false;
  return { game, facility };
}

function decorativeChild(element: Element, selector: string) {
  // Decorative SVGs have no accessible role.
  // eslint-disable-next-line testing-library/no-node-access
  return element.querySelector(selector);
}

function show(game: GameType, tileId: TerritoryTileId) {
  const store = configureStore({
    reducer: { game: gameReducer, ui: uiReducer },
    preloadedState: { game },
    middleware: (defaults) => defaults({ serializableCheck: false }),
  });
  render(
    <Provider store={store}>
      <GameToolMemoryContext.Provider
        value={new Map([["network.tile", tileId]])}
      >
        <TerritoryNetwork
          game={game}
          facilityActions={{
            onSell: jest.fn(),
            onPause: jest.fn(),
            onTogglePause: jest.fn(),
          }}
          onBuild={jest.fn()}
          onUpgrade={jest.fn()}
          onAcquire={jest.fn()}
          onBuyingRule={jest.fn()}
          onSellingRule={jest.fn()}
        />
      </GameToolMemoryContext.Provider>
    </Provider>,
  );
  const target = screen
    .getAllByRole<HTMLButtonElement>("button")
    .find((button) => button.dataset.mapTarget === tileId)!;
  const occupant = decorativeChild(
    screen.getByRole("img", { name: "Terrain and one structure per hex" }),
    `[data-occupant-tile="${tileId}"]`,
  )!;
  return { target, occupant };
}

it.each([
  [true, 0.25, "construction", "Under construction; operation paused"],
  [true, 0, "paused", "Operation paused"],
  [false, 0, "producing", "Generating"],
] as const)(
  "shares the %s paused / %i years status across map and inspector",
  (paused, years, kind, label) => {
    const { game, facility } = ready();
    facility.paused = paused;
    facility.yearsToBuildLeft = years;
    const { target, occupant } = show(game, facility.tileId!);
    expect(target).toHaveAccessibleDescription(expect.stringContaining(label));
    expect(target).not.toHaveAttribute("title");
    expect(occupant).toHaveAttribute("data-facility-status", kind);
    expect(occupant).toHaveAttribute("data-visibility-distance", "0");
    // The badge is a sibling of the faded facility body, under the same fog wrapper.
    expect(
      decorativeChild(occupant, ":scope > .facilityMapStatusArtwork"),
    ).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(target);
    expect(
      within(screen.getByRole("dialog")).getByText(new RegExp(`^${label} ·`)),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByText(new RegExp(`^${label} ·`)),
    ).toHaveTextContent(years ? /left$/ : "20/");
  },
);

it("reports staged retrofit output rather than an outage in the inspector", () => {
  const { game, facility } = ready();
  if (isStorage(facility)) throw new Error("Expected a starting generator");
  facility.upgradeInProgress = {
    upgrade: "coldWeatherPackage",
    cost: 1e6,
    startsMinute: game.date.minute,
    completesMinute: game.date.minute + 100,
  };
  const { target, occupant } = show(game, facility.tileId!);
  expect(occupant).toHaveAttribute("data-facility-status", "producing");
  expect(target).toHaveAccessibleDescription(
    expect.stringContaining("Generating; retrofit in progress"),
  );
  fireEvent.click(target);
  expect(
    within(screen.getByRole("dialog")).getByText(
      /^Generating; retrofit in progress ·/,
    ),
  ).toHaveTextContent("20/");
});

it("shows the foreign facility without an unavailable status", () => {
  const { game } = ready();
  const view = territoryTileViews(game).find(
    ({ owned, facility }) => !owned && facility,
  )!;
  const { target, occupant } = show(game, view.tile.id);
  expect(target).toHaveAccessibleDescription(
    expect.stringContaining(view.facility!.name),
  );
  expect(target).not.toHaveAccessibleDescription(
    /Operating status unavailable/,
  );
  expect(occupant).toHaveAttribute("data-facility-status", "unknown");
  expect(decorativeChild(occupant, ".facilityMapStatusArtwork")).toBeNull();
  fireEvent.click(target);
  const inspector = within(screen.getByRole("dialog"));
  expect(inspector.getByText(view.facility!.name)).toBeVisible();
  expect(
    inspector.queryByText("Operating status unavailable"),
  ).not.toBeInTheDocument();
});

it("renders and inspects separate peer properties with the same retained tile ID", () => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(3200);
  const { game } = ready();
  const tile = {
    id: "champlain:legacy-100",
    territoryId: "champlain",
    q: 6,
    r: -4,
    terrain: "plains",
    siteKind: "industrial",
    maxPeakW: 40e6,
  } as const;
  game.multiplayer = {
    seat: "0",
    legacyTiles: [
      {
        tile,
        seat: "1",
        name: "North Grid",
        facility: {
          name: "Oil",
          fuel: "Oil",
          peakW: 40e6,
          yearsToBuildLeft: 0,
        },
      },
      {
        tile: { ...tile, q: 7 },
        seat: "2",
        name: "South Grid",
        facility: {
          name: "Coal",
          fuel: "Coal",
          peakW: 40e6,
          yearsToBuildLeft: 0,
        },
      },
    ],
  };
  show(game, "champlain:city");
  const buttons = screen.getAllByRole("button");
  const north = buttons.filter((button) => button.dataset.owner === "peer:1");
  const south = buttons.filter((button) => button.dataset.owner === "peer:2");
  expect(north).toHaveLength(1);
  expect(south).toHaveLength(1);
  expect(north[0]).toHaveAccessibleDescription(expect.stringContaining("Oil"));
  expect(south[0]).toHaveAccessibleDescription(expect.stringContaining("Coal"));

  fireEvent.click(north[0]);
  const northInspection = within(screen.getByRole("dialog"));
  expect(northInspection.getByText("North Grid")).toBeVisible();
  expect(northInspection.getByText("Oil")).toBeVisible();
  fireEvent.click(south[0]);
  const southInspection = within(screen.getByRole("dialog"));
  expect(southInspection.getByText("South Grid")).toBeVisible();
  expect(southInspection.getByText("Coal")).toBeVisible();
});

it("toggles map names and the construction badge independently", () => {
  const { game, facility } = ready();
  facility.expansionInProgress = {
    projectSequence: 1,
    targetSize: facility.peakW + 1e6,
    targetPeakW: facility.peakW + 1e6,
    cost: 1e6,
    annualOperatingCostDelta: 0,
    costPerStartDelta: 0,
    startsMinute: 0,
    yearsToBuild: 1,
    yearsToBuildLeft: 1,
    quoteKey: "status-only-fixture",
  };
  const { occupant } = show(game, facility.tileId!);
  const city = screen.getByRole("button", {
    name: "Inspect Valley Electric territory · Winooski",
  });
  expect(within(city).getByText("Winooski")).toBeVisible();
  expect(within(city).getByText("Valley Electric")).toBeVisible();
  expect(occupant).toHaveAttribute("data-facility-status", "construction");
  fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
  const toggle = screen.getByRole("checkbox", { name: "Facility status" });
  fireEvent.click(toggle);
  expect(within(city).getByText("Winooski")).toBeVisible();
  expect(within(city).getByText("Valley Electric")).toBeVisible();
  const names = screen.getByRole("checkbox", { name: "Names" });
  fireEvent.click(names);
  expect(within(city).queryByText("Winooski")).not.toBeInTheDocument();
  expect(within(city).queryByText("Valley Electric")).not.toBeInTheDocument();
  expect(occupant).toHaveAttribute("data-facility-status", "construction");
  expect(decorativeChild(occupant, ".facilityMapStatusArtwork")).toBeNull();
  fireEvent.click(toggle);
  expect(decorativeChild(occupant, ".facilityMapStatusArtwork")).not.toBeNull();
  expect(within(city).queryByText("Winooski")).not.toBeInTheDocument();
  expect(within(city).queryByText("Valley Electric")).not.toBeInTheDocument();
  fireEvent.click(names);
  expect(within(city).getByText("Winooski")).toBeVisible();
  expect(within(city).getByText("Valley Electric")).toBeVisible();
});
