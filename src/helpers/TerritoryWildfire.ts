import {
  VALLEY_BOARD,
  type TerritoryTileDefinition,
} from "../data/TerritoryTiles";
import { getWeather } from "../data/Weather";
import { storyHash } from "../data/WorldEvents";
import type { GameType, TerritoryTileId } from "../Types";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { randomAt, RANDOM_STREAM } from "./Math";
import {
  getFacilityTile,
  hasTerritoryNetwork,
  legacyTerritoryTiles,
} from "./TerritoryTiles";

export const FIRE_SPREAD_MINUTES = 120;
export const FIRE_BURN_MINUTES = 240;
export const FIRE_REPAIR_MINUTES = 480;
export const FIRE_SCAR_MINUTES = 6 * MINUTES_PER_MONTH;
const MAX_BURN_TILES = 8;
const MIN_FIRE_SPACING = 3 * MINUTES_PER_MONTH;
const MAX_FIRE_HISTORY = 3;

interface FireTile {
  tileId: TerritoryTileId;
  ignitesMinute: number;
}
interface Wildfire {
  startsMinute: number;
  tiles: FireTile[];
}
export interface TerritoryWeatherState {
  dryness: number;
  fires: Wildfire[];
}
export type FireGroundCondition = "burning" | "scorched";

const neighbors = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;

export const combustibleTile = ({ terrain, city }: TerritoryTileDefinition) =>
  !city &&
  (terrain === "mountain" || terrain === "hills" || terrain === "forest");

const tileCoordinate = ({ q, r }: Pick<TerritoryTileDefinition, "q" | "r">) =>
  `${q},${r}`;

/** A retained noncombustible footprint is a firebreak even if the authored terrain beneath it is fuel. */
export function retainedWildfireFirebreaks(
  grids: readonly GameType[],
): ReadonlySet<string> {
  return new Set(
    grids.flatMap((grid) =>
      legacyTerritoryTiles(grid)
        .filter((tile) => !combustibleTile(tile))
        .map(tileCoordinate),
    ),
  );
}

const fuelTiles = VALLEY_BOARD.filter(combustibleTile);
const fuelAt = new Map(fuelTiles.map((tile) => [tileCoordinate(tile), tile]));
const fuelById = new Map(fuelTiles.map((tile) => [tile.id, tile]));

const draw = (seed: number, month: number, key: string) =>
  randomAt(
    seed,
    RANDOM_STREAM.wildfireHazards,
    storyHash(`valley-fire:${month}:${key}`),
  );

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** Fronts are addressed by season and physical position. Ownership and reveal never enter the draw. */
export function wildfireFront(
  board: readonly TerritoryTileDefinition[],
  origin: TerritoryTileDefinition,
  startsMinute: number,
  seed: number,
  maxTiles = MAX_BURN_TILES,
): FireTile[] {
  if (!combustibleTile(origin)) return [];
  const month = Math.floor(startsMinute / MINUTES_PER_MONTH);
  const fuels =
    board === VALLEY_BOARD
      ? fuelAt
      : new Map(
          board
            .filter(combustibleTile)
            .map((tile) => [tileCoordinate(tile), tile]),
        );
  const visited = new Set([origin.id]);
  const queue = [{ tile: origin, ignitesMinute: startsMinute }];
  for (const { tile, ignitesMinute } of queue) {
    // Finish while the month still has time to see the fire and its immediate effects.
    if (
      ignitesMinute + FIRE_SPREAD_MINUTES + FIRE_BURN_MINUTES >
      (month + 1) * MINUTES_PER_MONTH
    )
      break;
    const next = neighbors
      .flatMap(([dq, dr]) => {
        const candidate = fuels.get(`${tile.q + dq},${tile.r + dr}`);
        return candidate && !visited.has(candidate.id)
          ? [
              {
                candidate,
                rank: draw(seed, month, `spread:${tile.id}:${candidate.id}`),
              },
            ]
          : [];
      })
      .sort((a, b) => a.rank - b.rank);
    for (const { candidate } of next) {
      if (queue.length >= maxTiles) break;
      visited.add(candidate.id);
      queue.push({
        tile: candidate,
        ignitesMinute: ignitesMinute + FIRE_SPREAD_MINUTES,
      });
    }
  }
  return queue.map(({ tile, ignitesMinute }) => ({
    tileId: tile.id,
    ignitesMinute,
  }));
}

/** Same representative day as dispatch, with memory across dry or wet months. */
export function advanceTerritoryWeather(
  game: GameType,
  sharedFirebreaks?: ReadonlySet<string>,
): TerritoryWeatherState | undefined {
  if (
    !hasTerritoryNetwork(game) ||
    game.storyEffectsDisabled ||
    game.weatherHazardsDisabled
  )
    return game.territoryWeather;
  const month = game.date.monthsElapsed;
  const startsMinute = month * MINUTES_PER_MONTH;
  const prior = game.territoryWeather;
  const readings = [3, 9, 15, 21].map((hour) =>
    getWeather(
      getDateFromMinute(startsMinute + hour * 60, game.startingYear),
      game.seed,
      0,
      game.location.id,
    ),
  );
  const warmth = Math.max(...readings.map(({ TEMP_C }) => TEMP_C));
  const rain = readings.reduce((sum, { PRECIP_MM }) => sum + PRECIP_MM, 0) * 6;
  const dryness = unit(
    (prior?.dryness ?? 0.2) * 0.7 +
      unit((warmth - 9) / 21) * 0.47 -
      unit(rain / 5) * 0.54,
  );
  const fires = (prior?.fires ?? []).filter((fire) =>
    fire.tiles.some(
      ({ ignitesMinute }) =>
        startsMinute < ignitesMinute + FIRE_BURN_MINUTES + FIRE_SCAR_MINUTES,
    ),
  );
  const last = fires.at(-1);
  if (
    (!last || startsMinute - last.startsMinute >= MIN_FIRE_SPACING) &&
    warmth >= 24 &&
    dryness >= 0.54 &&
    draw(game.seed, month, "ignition") < 0.12 + (dryness - 0.54) * 0.4
  ) {
    const ignition =
      fuelTiles[
        Math.floor(draw(game.seed, month, "origin") * fuelTiles.length)
      ];
    const firebreaks = sharedFirebreaks ?? retainedWildfireFirebreaks([game]);
    if (ignition && !firebreaks.has(tileCoordinate(ignition))) {
      const board = firebreaks.size
        ? fuelTiles.filter((tile) => !firebreaks.has(tileCoordinate(tile)))
        : VALLEY_BOARD;
      fires.push({
        startsMinute,
        tiles: wildfireFront(board, ignition, startsMinute, game.seed),
      });
    }
  }
  return { dryness, fires };
}

export function wildfireTileConditions(
  weather: TerritoryWeatherState | undefined,
  minute: number,
): ReadonlyMap<string, FireGroundCondition> {
  const conditions = new Map<string, FireGroundCondition>();
  for (const fire of weather?.fires ?? []) {
    for (const { tileId, ignitesMinute } of fire.tiles) {
      const elapsed = minute - ignitesMinute;
      const tile = fuelById.get(tileId);
      if (
        tile &&
        elapsed >= 0 &&
        elapsed < FIRE_BURN_MINUTES + FIRE_SCAR_MINUTES
      )
        conditions.set(
          `${tile.q},${tile.r}`,
          elapsed < FIRE_BURN_MINUTES ? "burning" : "scorched",
        );
    }
  }
  return conditions;
}

/** Resolve occupants only at arrival. A replacement elsewhere or a sold facility never inherits a hit. */
export function wildfireContacts(
  game: GameType,
  constructionYearsElapsed: number,
) {
  const minute = game.date.minute;
  const fire = game.territoryWeather?.fires.at(-1);
  if (
    !fire ||
    minute < fire.startsMinute ||
    minute >= fire.startsMinute + MINUTES_PER_MONTH ||
    (minute - fire.startsMinute) % FIRE_SPREAD_MINUTES !== 0
  )
    return [];
  const arrivals = fire.tiles.filter(
    ({ ignitesMinute }) => ignitesMinute === minute,
  );
  if (!arrivals.length) return [];
  const hitTiles = new Set(
    arrivals.map(({ tileId }) => {
      const tile = fuelById.get(tileId)!;
      return `${tile.q},${tile.r}`;
    }),
  );
  return game.facilities.flatMap((facility) => {
    if (facility.yearsToBuildLeft > constructionYearsElapsed) return [];
    const tile = getFacilityTile(facility, game);
    if (!tile || !combustibleTile(tile) || !hitTiles.has(`${tile.q},${tile.r}`))
      return [];
    const availableFraction =
      0.4 +
      0.25 *
        draw(game.seed, game.date.monthsElapsed, `damage:${tile.q},${tile.r}`);
    return [{ facility, availableFraction }];
  });
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const boundedNumber = (value: unknown, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;

/** The weather state is optional in old saves. A supplied footprint must stay on its physical board. */
export function validTerritoryWeather(
  value: unknown,
  game: GameType,
  sharedFirebreaks?: ReadonlySet<string>,
): boolean {
  if (value === undefined) return true;
  if (
    !hasTerritoryNetwork(game) ||
    !record(value) ||
    !boundedNumber(value.dryness, 1) ||
    !Array.isArray(value.fires) ||
    value.fires.length > MAX_FIRE_HISTORY
  )
    return false;
  const firebreaks = sharedFirebreaks ?? retainedWildfireFirebreaks([game]);
  let previousStart = -MIN_FIRE_SPACING;
  return value.fires.every((fire: unknown) => {
    if (
      !record(fire) ||
      !boundedNumber(fire.startsMinute, game.date.minute) ||
      fire.startsMinute % MINUTES_PER_MONTH !== 0 ||
      fire.startsMinute - previousStart < MIN_FIRE_SPACING ||
      !Array.isArray(fire.tiles) ||
      fire.tiles.length < 1 ||
      fire.tiles.length > MAX_BURN_TILES
    )
      return false;
    const start = fire.startsMinute;
    previousStart = start;
    const visited = new Map<TerritoryTileId, number>();
    return fire.tiles.every((entry: unknown, index: number) => {
      if (
        !record(entry) ||
        typeof entry.tileId !== "string" ||
        !boundedNumber(
          entry.ignitesMinute,
          start + MINUTES_PER_MONTH - FIRE_BURN_MINUTES,
        ) ||
        entry.ignitesMinute < start ||
        (entry.ignitesMinute - start) % FIRE_SPREAD_MINUTES !== 0
      )
        return false;
      const tile = fuelById.get(entry.tileId as TerritoryTileId);
      if (!tile || visited.has(tile.id) || firebreaks.has(tileCoordinate(tile)))
        return false;
      const minute = entry.ignitesMinute;
      if (
        index === 0
          ? minute !== start
          : !neighbors.some(([dq, dr]) => {
              const source = fuelAt.get(`${tile.q + dq},${tile.r + dr}`);
              return (
                source &&
                visited.get(source.id) === minute - FIRE_SPREAD_MINUTES
              );
            })
      )
        return false;
      visited.set(tile.id, minute);
      return true;
    });
  });
}
