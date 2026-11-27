import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import uiReducer from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import RegionalGridMap from "./RegionalGridMap";
import type TerritoryHexMap from "./TerritoryHexMap";

jest.mock("../../data/DataCenterCustomers", () => ({
  ...jest.requireActual("../../data/DataCenterCustomers"),
  initDataCenterCustomers: () => Promise.reject(new Error("Offline")),
}));

// Drive the inspector through the map's selection callback without mounting the 3D renderer.
jest.mock("./TerritoryHexMap", () => ({
  __esModule: true,
  default: function MockMap({
    views,
    onSelect,
  }: React.ComponentProps<typeof TerritoryHexMap>) {
    return views.map(({ tile, operatingFacility }) =>
      operatingFacility ? (
        <button
          key={tile.id}
          data-map-target={tile.id}
          onClick={() => onSelect(tile.id, true)}
        >
          Inspect {operatingFacility.name}
        </button>
      ) : null,
    );
  },
}));

it("keeps a facility inspector through updates and closes it when a dam takes its plot", () => {
  const scenario = { scenarioId: 111, seed: 1 };
  const game = createGame(scenario);
  const built = createGame({
    ...scenario,
    initialBuild: { name: "Hydro", peakW: 10_000_000, financed: true },
  });
  const hydroSiteId = "venice-hydro-us";
  const damBuilt = {
    ...built,
    facilities: built.facilities.map((facility) =>
      facility.name === "Hydro" ? { ...facility, hydroSiteId } : facility,
    ),
    commissionedHydroSiteIds: [...game.commissionedHydroSiteIds, hydroSiteId],
  };
  const solar = game.facilities.find(({ name }) => name === "Solar")!;
  const actions = {
    onPause: jest.fn(),
    onTogglePause: jest.fn(),
    onSell: jest.fn(),
  };
  const store = configureStore({ reducer: { ui: uiReducer } });
  const show = (state: typeof game) => (
    <Provider store={store}>
      <RegionalGridMap game={state} facilityActions={actions} />
    </Provider>
  );
  const { rerender } = render(show(game));
  const solarTile = screen.getByRole("button", { name: "Inspect Solar" });
  expect(solarTile).toHaveAttribute("data-map-target", "frontier:-2:1");
  fireEvent.click(solarTile);

  const paused = {
    ...game,
    facilities: game.facilities.map((facility) =>
      facility.id === solar.id ? { ...facility, paused: true } : facility,
    ),
  };
  rerender(show(paused));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Solar" })).getByRole("button", {
      name: "Resume Solar",
    }),
  );
  expect(actions.onTogglePause).toHaveBeenCalledWith(solar.id);

  rerender(show(damBuilt));
  const hydroTile = screen.getByRole("button", { name: "Inspect Hydro" });
  expect(hydroTile).toHaveAttribute("data-map-target", "frontier:-2:1");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  // A later layout update cannot reopen a dismissed inspection.
  rerender(show(game));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  rerender(show(damBuilt));
  fireEvent.click(screen.getByRole("button", { name: "Inspect Hydro" }));
  expect(screen.getByRole("dialog", { name: "Hydro" })).toBeVisible();
});
