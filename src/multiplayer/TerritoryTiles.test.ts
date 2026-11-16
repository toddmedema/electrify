import { getScenario } from "../data/Scenarios";
import { getScenarioLocation } from "../helpers/Locations";
import { currentTick } from "../helpers/GameSelectors";
import { getTerritoryTiles } from "../helpers/TerritoryTiles";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
} from "./World";
import type { World } from "./Types";
function ready(scenarioId = 116) {
  loadSimData(getScenarioLocation(getScenario(scenarioId))!);
  return createWorld(
    { scenarioId, difficulty: "Employee" },
    coopSeats(2),
    "tile-placement",
    "epoch",
  );
}
function build(world: World, tileId: unknown) {
  return applyCommand(world, "0", {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences["0"] ?? 0) + 1,
    command: {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: { name: "Wind", peakW: 50e6, buildCost: 0 },
        financed: true,
        territoryId: "champlain",
        tileId,
      },
    },
  });
}
it("host reserves the requested physical cell and rejects competing placements before charging", () => {
  const world = ready();
  const tile = getTerritoryTiles().find(
    (tile) =>
      tile.territoryId === "champlain" &&
      tile.siteKind === "wind" &&
      tile.terrain !== "ocean" &&
      !tile.startingAssetId,
  )!;
  expect(build(world, tile.id)).toBeUndefined();
  const cash = currentTick(world.grids[0])!.cash;
  const project = world.grids[0].facilities.find(
    (facility) => facility.tileId === tile.id,
  )!;
  expect(project.buildCost).toBeGreaterThan(0);
  expect(project.yearsToBuildLeft).toBeGreaterThan(0);
  expect(build(world, tile.id)).toMatch(/already/i);
  expect(currentTick(world.grids[0])!.cash).toBe(cash);
  expect(
    world.grids[0].facilities.filter((facility) => facility.tileId === tile.id),
  ).toHaveLength(1);
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "restart",
  );
  expect(build(restored, tile.id)).toMatch(/already/i);
});
it.each([
  "champlain:city",
  "valley-electric:site-1",
  "champlain:site-14",
  "invented",
  4,
  null,
])("host rejects invalid tile destination %s atomically", (id) => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(build(world, id)).toBeDefined();
  expect(JSON.stringify(world.grids[0])).toBe(before);
});
it.each([106, 116])(
  "migrates recognized published schema15 scenario%i without changing assets or cash",
  (scenarioId) => {
    const world = ready(scenarioId);
    const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
    raw.gameSchema = 15;
    raw.rules =
      "coop-2-c12bab1ee04886f40ff0274d35e968e07cf7c3306f9e5ea006140bb973163fe4";
    for (const grid of raw.grids)
      for (const facility of grid.facilities) delete facility.tileId;
    const before = JSON.stringify(raw);
    const restored = restoreWorld(raw, "upgraded");
    expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
    expect(JSON.stringify(raw)).toBe(before);
    expect(restored.grids.map((grid) => currentTick(grid)!.cash)).toEqual(
      world.grids.map((grid) => currentTick(grid)!.cash),
    );
    expect(
      restored.grids.map((grid) => grid.facilities.map(({ id }) => id)),
    ).toEqual(world.grids.map((grid) => grid.facilities.map(({ id }) => id)));
    expect(
      new Set(restored.grids[0].facilities.map(({ tileId }) => tileId)).size,
    ).toBe(scenarioId === 116 ? restored.grids[0].facilities.length : 1);
    expect(
      restored.grids[0].facilities.every(({ tileId }) => tileId === undefined),
    ).toBe(scenarioId !== 116);
    raw.rules = "unrecognized";
    expect(() => restoreWorld(raw, "rejected")).toThrow();
  },
);
