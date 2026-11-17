import { fireEvent, render, screen } from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import {
  getTerritoryTiles,
  facilityOnTile,
} from "../../helpers/TerritoryTiles";
import type { TerritoryTileId } from "../../Types";
import TerritoryBuildDestination, {
  territoryBuildTileName,
  territoryName,
} from "./TerritoryBuildDestination";

it("labels ordinary inventory separately from a selected technology's terrain allowance", () => {
  expect(territoryBuildTileName("champlain:site-12")).toContain(
    "1GW max; varies by technology",
  );
  expect(
    territoryBuildTileName("champlain:site-12", undefined, { fuel: "Sun" }),
  ).toContain("150MW max");
  expect(
    territoryBuildTileName("champlain:site-12", undefined, { fuel: "Wind" }),
  ).toContain("300MW max");
});

it("offers free physical sites with terrain and power labels, excluding cities and occupied tiles", () => {
  const game = createGame({ scenarioId: 116, seed: 12 });
  const onTileChange = jest.fn();
  render(
    <TerritoryBuildDestination
      game={game}
      value="champlain"
      onChange={jest.fn()}
      onTileChange={onTileChange}
    />,
  );
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Build tile" }));
  const options = screen.getAllByRole("option");
  const free = getTerritoryTiles(game).filter(
    (tile) =>
      tile.territoryId === "champlain" &&
      !tile.city &&
      !facilityOnTile(game, tile.id) &&
      (!tile.hydroSiteId ||
        !game.commissionedHydroSiteIds?.includes(tile.hydroSiteId)),
  );
  expect(options.map((option) => option.dataset.value)).toEqual([
    "",
    ...free.map((tile) => tile.id),
  ]);
  for (const tile of free) {
    const offered = options.find((option) => option.dataset.value === tile.id);
    expect(offered).toHaveTextContent(territoryBuildTileName(tile.id, game));
    expect(offered).toHaveTextContent(/site.*max/);
    expect(offered).not.toHaveTextContent(tile.id);
  }
  fireEvent.click(
    screen.getByRole("option", {
      name: territoryBuildTileName(free[0].id, game),
    }),
  );
  expect(onTileChange).toHaveBeenCalledWith(free[0].id);
});

it("clears the selected physical tile when the build territory changes", () => {
  const game = createGame({ scenarioId: 116, seed: 12 });
  game.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  const tile = getTerritoryTiles(game).find(
    (candidate) =>
      candidate.territoryId === "champlain" &&
      !candidate.city &&
      candidate.siteKind === "open-land",
  )!;
  const onChange = jest.fn();
  const onTileChange = jest.fn();
  render(
    <TerritoryBuildDestination
      game={game}
      value="champlain"
      tileId={tile.id}
      onChange={onChange}
      onTileChange={onTileChange}
    />,
  );
  fireEvent.mouseDown(
    screen.getByRole("combobox", { name: "Build destination" }),
  );
  fireEvent.click(
    screen.getByRole("option", { name: territoryName("green-uplands") }),
  );
  expect(onChange).toHaveBeenCalledWith("green-uplands");
  expect(onTileChange).toHaveBeenCalledWith(undefined);
});

it("clears a remembered city, occupied tile or tile in a different territory", () => {
  const game = createGame({ scenarioId: 116, seed: 12 });
  const tiles = getTerritoryTiles(game);
  const city = tiles.find(
    (tile) => tile.territoryId === "champlain" && tile.city,
  )!;
  const occupied = tiles.find((tile) => facilityOnTile(game, tile.id))!;
  const foreign = tiles.find((tile) => tile.territoryId === "valley-electric")!;
  const onTileChange = jest.fn();
  const destination = (tileId: TerritoryTileId) => (
    <TerritoryBuildDestination
      game={game}
      value="champlain"
      tileId={tileId}
      onChange={jest.fn()}
      onTileChange={onTileChange}
    />
  );
  const view = render(destination(city.id));
  expect(onTileChange).toHaveBeenCalledWith(undefined);
  for (const tile of [occupied, foreign]) {
    onTileChange.mockClear();
    view.rerender(destination(tile.id));
    expect(onTileChange).toHaveBeenCalledWith(undefined);
    expect(
      screen.getByRole("combobox", { name: "Build tile" }),
    ).toHaveTextContent("Choose a free tile automatically");
  }
});
