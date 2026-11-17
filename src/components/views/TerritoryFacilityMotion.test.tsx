import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createGame } from "../../testing/Simulator";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import type { GameType, TerritoryTileId } from "../../Types";
import { FacilityArtwork } from "../base/TerritoryTileArtwork";
import { TerritoryTilePurchasesProvider } from "../base/TerritoryTilePurchases";
import useFacilityMapMotion from "../base/useFacilityMapMotion";
import TerritoryHexMap from "./TerritoryHexMap";

// Decorative SVG state has no separate accessible control; inspect its rendered attributes.
/* eslint-disable testing-library/no-node-access, testing-library/no-container */
let reduced: boolean;
let media: MediaQueryList;
let hidden: jest.SpyInstance;
beforeEach(() => {
  reduced = false;
  media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { get: () => reduced });
  jest.spyOn(window, "matchMedia").mockReturnValue(media);
  hidden = jest.spyOn(document, "hidden", "get").mockReturnValue(false);
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});
afterEach(() => jest.restoreAllMocks());

function draw(game: GameType, tileId: TerritoryTileId) {
  const store = configureStore({
    reducer: {
      game: (state = game) => state,
      ui: (state = { evidenceRunId: 1 }) => state,
    },
  });
  const view = render(
    <Provider store={store}>
      <TerritoryTilePurchasesProvider game={game}>
        <TerritoryHexMap game={game} selected={tileId} onSelect={jest.fn()} />
      </TerritoryTilePurchasesProvider>
    </Provider>,
  );
  const occupant = view.container.querySelector(
    `[data-occupant-tile="${tileId}"]`,
  );
  expect(occupant).not.toBeNull();
  return { ...view, occupant: occupant! };
}

function workingWind() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const wind = game.facilities.find((facility) => facility.fuel === "Wind")!;
  wind.yearsToBuildLeft = 0;
  wind.currentW = 20e6;
  wind.paused = false;
  return { game, wind };
}

it("moves measured owned production even while the simulation clock is paused", () => {
  const { game, wind } = workingWind();
  game.speed = "PAUSED";
  const { occupant } = draw(game, wind.tileId!);
  expect(occupant).toHaveAttribute("data-facility-status", "producing");
  expect(
    occupant.querySelector("[data-facility-motion='active']"),
  ).not.toBeNull();
  expect(occupant.querySelector(".mapWindRotor")).not.toBeNull();
});

it.each(["idle", "paused", "construction"] as const)(
  "keeps %s facilities still, including retained measured output",
  (state) => {
    const { game, wind } = workingWind();
    if (state === "idle") wind.currentW = 0;
    if (state === "paused") wind.paused = true;
    if (state === "construction") wind.yearsToBuildLeft = 0.2;
    const { occupant } = draw(game, wind.tileId!);
    expect(occupant).toHaveAttribute("data-facility-status", state);
    expect(occupant.querySelector("[data-facility-motion]")).toBeNull();
  },
);

it("does not invent operating motion for an independent utility", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const foreign = territoryTileViews(game).find(
    (view) => view.facility && !view.operatingFacility,
  )!;
  const { occupant } = draw(game, foreign.tile.id);
  expect(occupant).toHaveAttribute("data-facility-status", "unknown");
  expect(occupant.querySelector("[data-facility-motion]")).toBeNull();
});

it("responds to reduced-motion and document visibility changes without changing status", () => {
  reduced = true;
  const { game, wind } = workingWind();
  const { occupant } = draw(game, wind.tileId!);
  const moving = () => occupant.querySelector("[data-facility-motion]");
  expect(moving()).toBeNull();
  act(() => {
    reduced = false;
    media.dispatchEvent(new Event("change"));
  });
  expect(moving()).not.toBeNull();
  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(moving()).toBeNull();
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  expect(moving()).not.toBeNull();
  act(() => {
    reduced = true;
    media.dispatchEvent(new Event("change"));
  });
  expect(moving()).toBeNull();
  expect(occupant).toHaveAttribute("data-facility-status", "producing");
});

it("releases the map's single media and document visibility subscriptions", () => {
  const removeMedia = jest.spyOn(media, "removeEventListener");
  const removeDocument = jest.spyOn(document, "removeEventListener");
  function Motion() {
    return <output>{useFacilityMapMotion() ? "Moving" : "Still"}</output>;
  }
  const { unmount } = render(<Motion />);
  expect(screen.getByRole("status")).toHaveTextContent("Moving");
  unmount();
  expect(removeMedia).toHaveBeenCalledWith("change", expect.any(Function));
  expect(removeDocument).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function),
  );
});

it("keeps solar panels and storage static even with measured output", () => {
  const { container, rerender } = render(
    <FacilityArtwork facility={{ name: "Solar", fuel: "Sun" }} active />,
  );
  expect(container.querySelector("[data-facility-motion]")).toBeNull();
  rerender(
    <FacilityArtwork facility={{ name: "Battery", peakWh: 100e6 }} active />,
  );
  expect(container.querySelector("[data-facility-motion]")).toBeNull();
});

it.each(["Oil", "Uranium", "Biomass", "Hydro"] as const)(
  "removes %s exhaust or flow when the facility stops working",
  (fuel) => {
    const { container, rerender } = render(
      <FacilityArtwork facility={{ name: fuel, fuel }} active />,
    );
    expect(
      container.querySelector(".mapFacilityExhaust, .mapHydroFlow"),
    ).not.toBeNull();
    rerender(<FacilityArtwork facility={{ name: fuel, fuel }} />);
    expect(
      container.querySelector(".mapFacilityExhaust, .mapHydroFlow"),
    ).toBeNull();
  },
);
