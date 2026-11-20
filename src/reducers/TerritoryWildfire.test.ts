import { freeze, produce } from "immer";
import { TICK_MINUTES, YEARS_PER_TICK } from "../Constants";
import {
  VALLEY_BOARD,
  type TerritoryTileDefinition,
} from "../data/TerritoryTiles";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame } from "../testing/Simulator";
import type { GameType, TerrainType } from "../Types";
import { getDateFromMinute } from "../helpers/DateTime";
import { facilityHazardStatus, WILDFIRE_DAMAGE_ID } from "../helpers/Hazards";
import { facilityTileId } from "../helpers/TerritoryTiles";
import {
  combustibleTile,
  FIRE_BURN_MINUTES,
  FIRE_REPAIR_MINUTES,
  FIRE_SCAR_MINUTES,
  FIRE_SPREAD_MINUTES,
  wildfireFront,
  wildfireTileConditions,
} from "../helpers/TerritoryWildfire";
import { tickState } from "./Game";

function testTile(
  q: number,
  r: number,
  terrain: TerrainType,
): TerritoryTileDefinition {
  return {
    id: `parcel-1:site-${q + r * 10}`,
    q,
    r,
    terrain,
    territoryId: "parcel-1",
    siteKind: "open-land",
    maxPeakW: 1,
  };
}

it.each(["plains", "lake", "river", "ocean", "city"] as const)(
  "never jumps over a %s firebreak",
  (terrain) => {
    const origin = testTile(0, 0, "forest");
    const middle = testTile(1, 0, terrain === "city" ? "forest" : terrain);
    const firebreak =
      terrain === "city"
        ? {
            id: middle.id,
            territoryId: middle.territoryId,
            terrain: middle.terrain,
            q: middle.q,
            r: middle.r,
            city: { size: "small" as const },
          }
        : middle;
    const mountain = testTile(2, 0, "mountain");
    const hill = testTile(0, 1, "hills");
    const board = [origin, firebreak, mountain, hill];
    expect(wildfireFront(board, origin, 0, 3)).toEqual([
      { tileId: origin.id, ignitesMinute: 0 },
      { tileId: hill.id, ignitesMinute: FIRE_SPREAD_MINUTES },
    ]);
    expect(wildfireFront([...board].reverse(), origin, 0, 3)).toEqual(
      wildfireFront(board, origin, 0, 3),
    );
  },
);

function approachFacility() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const target = game.facilities.find((facility) =>
    VALLEY_BOARD.some(
      (tile) => tile.id === facilityTileId(facility) && combustibleTile(tile),
    ),
  )!;
  const site = VALLEY_BOARD.find((tile) => tile.id === facilityTileId(target))!;
  const source = VALLEY_BOARD.find((tile) => {
    const q = tile.q - site.q;
    const r = tile.r - site.r;
    return (
      combustibleTile(tile) &&
      Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 1
    );
  })!;
  const state: GameType = {
    ...game,
    date: getDateFromMinute(
      FIRE_SPREAD_MINUTES - TICK_MINUTES,
      game.startingYear,
    ),
    territoryWeather: {
      dryness: 0.81,
      fires: [
        {
          startsMinute: 0,
          tiles: [
            { tileId: source.id, ignitesMinute: 0 },
            { tileId: site.id, ignitesMinute: FIRE_SPREAD_MINUTES },
          ],
        },
      ],
    },
  };
  return { state, target, source, site };
}

it("damages the contacted facility on a frozen live tick and restores the same running fire from a save", () => {
  const { state, target, site } = approachFacility();
  const before = freeze(state, true);
  const save = parseSave(serializeSave(before));
  expect(save).not.toBeNull();

  const advance = (game: GameType) =>
    produce(game, (draft) => {
      tickState(draft);
    });
  const actual = advance(before);
  const restored = advance(save!.game);

  expect(actual.date.minute).toBe(FIRE_SPREAD_MINUTES);
  expect(
    wildfireTileConditions(actual.territoryWeather, actual.date.minute).get(
      `${site.q},${site.r}`,
    ),
  ).toBe("burning");
  const impacts = actual.worldEvents.active.filter(
    ({ definitionId }) => definitionId === WILDFIRE_DAMAGE_ID,
  );
  expect(impacts).toEqual(
    restored.worldEvents.active.filter(
      ({ definitionId }) => definitionId === WILDFIRE_DAMAGE_ID,
    ),
  );
  expect(impacts).toHaveLength(1);
  expect(impacts[0].attributes.facilityId).toBe(target.id);
  expect(
    actual.facilities.find(({ id }) => id === target.id)!.currentW,
  ).toBeLessThanOrEqual(
    target.peakW *
      impacts[0].effects.facilityOutputMultipliersById![String(target.id)],
  );
  expect(facilityHazardStatus(actual, target)).toMatchObject({
    label: "Wildfire damage",
    endsMinute: FIRE_SPREAD_MINUTES + FIRE_REPAIR_MINUTES,
  });
  expect(
    actual.facilities
      .filter((facility) => facility.id !== target.id)
      .some((facility) => facilityHazardStatus(actual, facility)),
  ).toBe(false);
  expect(before.worldEvents.active).toEqual([]);

  const scorchMinute = FIRE_SPREAD_MINUTES + FIRE_BURN_MINUTES;
  expect(
    wildfireTileConditions(actual.territoryWeather, scorchMinute).get(
      `${site.q},${site.r}`,
    ),
  ).toBe("scorched");
  expect(
    wildfireTileConditions(
      actual.territoryWeather,
      scorchMinute + FIRE_SCAR_MINUTES,
    ).size,
  ).toBe(0);
});

it("rejects a saved fire that jumps over a hex", () => {
  const { state, source } = approachFacility();
  const unreachable = VALLEY_BOARD.find(
    (tile) => combustibleTile(tile) && Math.abs(tile.q - source.q) >= 2,
  )!;
  state.territoryWeather!.fires[0].tiles[1].tileId = unreachable.id;
  expect(parseSave(serializeSave(state))).toBeNull();
});

it.each([
  { remaining: YEARS_PER_TICK, damaged: true },
  { remaining: YEARS_PER_TICK * 2, damaged: false },
])(
  "settles contact consistently with construction ($damaged)",
  ({ remaining, damaged }) => {
    const { state, target } = approachFacility();
    state.facilities = state.facilities.map((facility) =>
      facility.id === target.id
        ? { ...facility, yearsToBuildLeft: remaining }
        : facility,
    );
    const advanced = produce(state, (draft) => tickState(draft));
    const contacted = advanced.facilities.find(({ id }) => id === target.id)!;
    expect(contacted.yearsToBuildLeft === 0).toBe(damaged);
    expect(
      facilityHazardStatus(advanced, contacted)?.hazard === "WILDFIRE",
    ).toBe(damaged);
  },
);
