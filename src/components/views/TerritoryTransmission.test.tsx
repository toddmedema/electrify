import { render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import reducer from "../../reducers/Game";
import { createGame } from "../../testing/Simulator";
import { territoryTileViews } from "../../helpers/TerritoryMapState";
import { TerritoryTilePurchasesProvider } from "../base/TerritoryTilePurchases";
import TerritoryHexMap from "./TerritoryHexMap";

// Decoration and cable attachment are SVG contracts rather than interactive controls.
/* eslint-disable testing-library/no-node-access */
beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});
afterEach(() => jest.restoreAllMocks());

it("keeps owned open water free of unsupported towers while retaining the dam", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const views = territoryTileViews(game);
  const water = views.find(
    ({ tile, developed, facility }) =>
      developed && !facility && !tile.city && tile.terrain === "lake",
  )!;
  const hydro = views.find(({ facility }) => facility?.fuel === "Hydro")!;
  expect(water).toBeDefined();
  const store = configureStore({
    reducer: { game: reducer },
    preloadedState: { game },
  });
  render(
    <Provider store={store}>
      <TerritoryTilePurchasesProvider game={game}>
        <TerritoryHexMap
          game={game}
          views={views}
          selected={water.tile.id}
          onSelect={() => undefined}
        />
      </TerritoryTilePurchasesProvider>
    </Provider>,
  );
  const map = screen.getByRole("region", { name: "Territory map" });
  expect(
    map.querySelector(`[data-map-target="${water.tile.id}"]`),
  ).not.toBeNull();
  expect(
    map.querySelector(`[data-occupant-tile="${water.tile.id}"]`),
  ).toBeNull();
  expect(
    map.querySelector(`[data-map-target="${water.tile.id}"]`),
  ).toHaveAccessibleDescription(/^Lake · No compatible technology$/);
  expect(
    map.querySelector(`[data-occupant-tile="${hydro.tile.id}"]`),
  ).toHaveAttribute("data-occupant", "generator");
  const cables = map.querySelectorAll(
    `[data-wire-from="${water.tile.id}"], [data-wire-to="${water.tile.id}"]`,
  );
  expect(cables.length).toBeGreaterThan(0);
  cables.forEach((cable) =>
    expect(cable).toHaveAttribute("data-wire-kind", "submerged"),
  );
});
