import "../Store";
import reducer, { gameSlice } from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { LOCATIONS } from "../Constants";
import { getBuildFacilityQuote } from "../data/Facilities";
import { frontierCoordinates, frontierTerritoryId } from "../data/Territories";
import { loadSimData } from "../testing/SimData";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { applyCommand, createWorld } from "../multiplayer/World";
import type { FrontierTerritoryId, GameType } from "../Types";
import { currentCash } from "./GameSelectors";
import { HEX_NEIGHBORS } from "./HexNeighbors";
import {
  createMultiplayerTerritory,
  multiplayerBorderConnection,
  multiplayerBuildAvailability,
  multiplayerClaimQuote,
  multiplayerOwnedTileIds,
  multiplayerTerritoryTiles,
} from "./MultiplayerTerritory";
import { tileFitsFacility } from "./TerritoryTiles";

let initial: GameType;

beforeAll(() => {
  loadSimData("SF");
  initial = createWorld(COOP_TEST_SPEC, coopSeats(2), "board", "epoch")
    .grids[0];
});

function adjacent(id: FrontierTerritoryId): FrontierTerritoryId[] {
  const { q, r } = frontierCoordinates(id)!;
  return HEX_NEIGHBORS.flatMap(([dq, dr]) => {
    const neighbor = frontierTerritoryId(q + dq, r + dr);
    return neighbor ? [neighbor] : [];
  });
}

test.each([2, 3, 4])(
  "the shared %i-company board gives every company independent connected property",
  (seatCount) => {
    const grids = Array.from({ length: seatCount }, (_, seatIndex) =>
      createMultiplayerTerritory(initial, seatIndex, seatCount, 2),
    );
    const allOwned = grids.flatMap(multiplayerOwnedTileIds);
    expect(new Set(allOwned).size).toBe(allOwned.length);
    grids.forEach((grid, i) => {
      const { homeTileId, startingTileIds } = grid.multiplayer!.territorial!;
      expect(multiplayerTerritoryTiles(grid)).toEqual(
        multiplayerTerritoryTiles(grids[0]),
      );
      expect(grid).toEqual(
        createMultiplayerTerritory(initial, i, seatCount, 2),
      );
      const reachable = new Set([homeTileId]);
      for (const id of reachable) {
        adjacent(id)
          .filter((neighbor) => startingTileIds.includes(neighbor))
          .forEach((neighbor) => reachable.add(neighbor));
      }
      expect(reachable.size).toBe(startingTileIds.length);
      expect(
        grid.facilities.every(({ tileId }) =>
          startingTileIds.includes(tileId as FrontierTerritoryId),
        ),
      ).toBe(true);
    });
    expect(multiplayerBorderConnection(grids[0], grids[1])).toBeUndefined();
  },
);

test("a full opening fleet retains a disjoint board and two normal construction sites at every location", () => {
  const fleet = Array.from({ length: 40 }, (_, i) => ({
    ...initial.facilities[0],
    id: i + 1,
  }));
  for (const location of Object.values(LOCATIONS)) {
    const game = { ...initial, location, facilities: fleet };
    const grids = Array.from({ length: 4 }, (_, i) =>
      createMultiplayerTerritory(game, i, 4, 2),
    );
    const claims = grids.flatMap(multiplayerOwnedTileIds);
    expect(new Set(claims).size).toBe(4 * 43);
    for (const grid of grids) {
      const availability = multiplayerBuildAvailability(grid, {
        name: "Solar",
        fuel: "Sun",
        peakW: 1e6,
      });
      expect(availability).toMatchObject({ buildable: true, remaining: 2 });
    }
  }
});

test.each([2, 3, 4])(
  "every company in a %i-player territorial match can build twice without buying a connection",
  (count) => {
    const world = createWorld(
      { ...COOP_TEST_SPEC, territorialVersion: 1 },
      coopSeats(count),
      "board",
      "epoch",
    );
    const project = { name: "Solar", fuel: "Sun", peakW: 1e6 } as const;
    for (const [index, seat] of world.seats.entries()) {
      const opening = world.grids[index];
      const owned = new Set(multiplayerOwnedTileIds(opening));
      const occupied = new Set(opening.facilities.map(({ tileId }) => tileId));
      const sites = multiplayerTerritoryTiles(opening)
        .filter((tile) => owned.has(tile.id) && !occupied.has(tile.id))
        .filter((tile) => tileFitsFacility(tile, project))
        .slice(0, 2);
      expect(sites).toHaveLength(2);
      for (const [slot, { id }] of sites.entries()) {
        const facility = getBuildFacilityQuote(
          world.grids[index],
          project,
          undefined,
          id,
        )!;
        expect(
          applyCommand(world, seat.id, {
            matchId: world.matchId,
            epoch: world.epoch,
            sequence: slot + 1,
            command: {
              kind: "action",
              name: "buildFacility",
              payload: { facility, financed: false, tileId: id },
            },
          }),
        ).toBeUndefined();
        expect(world.grids[index].facilities).toContainEqual(
          expect.objectContaining({ tileId: id, name: project.name }),
        );
      }
      expect(world.grids[index].multiplayer!.territorial!.claims).toEqual([]);
    }
  },
);

test("the reducer debits verified adjacent claims and enforces occupancy for real construction", () => {
  const game = createMultiplayerTerritory(initial, 0, 2, 2);
  const allTiles = multiplayerTerritoryTiles(game);
  const project = { name: "Solar", fuel: "Sun", peakW: 1e6 } as const;
  const eligible = allTiles
    .filter((tile) => tileFitsFacility(tile, project))
    .map(({ id }) => multiplayerClaimQuote(game, id))
    .find((quote) => !!quote)!;
  expect(eligible).toBeDefined();
  const blocked = {
    ...game,
    multiplayer: {
      ...game.multiplayer!,
      tileOwners: { [eligible.tileId]: { seat: "1", name: "Peer" } },
    },
  };
  expect(reducer(blocked, acquireTile(eligible))).toBe(blocked);
  expect(reducer(game, acquireTile({ ...eligible, quoteKey: "stale" }))).toBe(
    game,
  );

  const claimed = reducer(game, acquireTile(eligible));
  expect(currentCash(claimed)).toBe(currentCash(game) - eligible.price);
  expect(multiplayerOwnedTileIds(claimed)).toContain(eligible.tileId);
  expect(reducer(claimed, acquireTile(eligible))).toBe(claimed);
  const quote = getBuildFacilityQuote(
    claimed,
    project,
    undefined,
    eligible.tileId,
  )!;
  const build = gameSlice.actions.buildFacility({
    facility: quote,
    financed: false,
    tileId: eligible.tileId,
  });
  expect(reducer(game, build)).toBe(game);
  const built = reducer(claimed, build);
  expect(built.facilities).toHaveLength(game.facilities.length + 1);
  expect(
    built.facilities.find(({ tileId }) => tileId === eligible.tileId),
  ).toMatchObject({
    name: "Solar",
    peakW: project.peakW,
  });
  expect(reducer(built, build)).toBe(built);
});
