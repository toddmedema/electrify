import type {
  CitySizeType,
  TerrainType,
  TerritoryId,
  TerritoryTileId,
} from "../Types";
import { citySizeForTerritory } from "../helpers/CityProfiles";
import {
  TERRITORIES,
  territoryHydroSiteId,
  frontierCoordinates,
  frontierTerritoryId,
  getTerritoryDefinition,
  territoryCoordinateHash,
  type TerritorySiteKind,
} from "./Territories";
import { UTILITY_AREAS } from "./UtilityExpansion";

type TileBase = {
  id: TerritoryTileId;
  territoryId: TerritoryId;
  q: number;
  r: number;
  terrain: TerrainType;
};
export type TerritoryTileDefinition = TileBase &
  (
    | {
        city: { size: CitySizeType; name?: string };
        siteKind?: never;
        maxPeakW?: never;
        startingAssetId?: never;
        hydroSiteId?: never;
      }
    | {
        city?: never;
        siteKind: TerritorySiteKind;
        maxPeakW: number;
        startingAssetId?: string;
        hydroSiteId?: string;
      }
  );

const coordinates = (rows: readonly [number, readonly number[]][]) =>
  rows.flatMap(([r, columns]) => columns.map((q) => ({ q, r })));
const utilityCoordinates: Record<
  "champlain" | "valley-electric" | "ridge-electric",
  { q: number; r: number }[]
> = {
  // Burlington sits south of the river city. Keep the inherited lake locations.
  champlain: coordinates([
    [-3, [-1]],
    [-4, [-3, -2, -1]],
    [-3, [-4, -3, -2]],
    [-4, [-4]],
    [-2, [-3, -2, -1]],
    [-1, [-4, -3, -2, -1]],
    [-2, [-4]],
  ]),
  "valley-electric": coordinates([
    [-4, [0, 1, 2, 3, 4]],
    [-3, [0, 1, 2, 3, 4]],
    [-2, [0, 1, 2]],
  ]),
  "ridge-electric": coordinates([-1, 0, 1].map((r) => [r, [0, 1, 2, 3]])),
};
const greenCoordinates = coordinates([
  [0, [-4, -3, -2, -1]],
  [1, [-3, -2, -1]],
]);
// Keep each two-cell parcel adjacent around the western settlement corridor.
const neutralCoordinates = coordinates([
  [2, [-2, -3, -4, -1, 0, 1, 2, 3, 4, 5]],
  [3, [5, 4, 3, 2, 1, 0, -1, -4, -3, -2]],
  [4, [-4, -3, -2, -1, 0, 1, 2, 3]],
]);
const landTerrains: readonly TerrainType[] = [
  "plains",
  "forest",
  "hills",
  "mountain",
];
function siteTerrain(kind: TerritorySiteKind, index: number): TerrainType {
  if (kind === "hydro") return "lake";
  if (kind === "geothermal") return "mountain";
  if (kind === "wind")
    return ["hills", "mountain", "plains"][index % 3] as TerrainType;
  if (kind === "open-land")
    return ["plains", "hills", "forest"][index % 3] as TerrainType;
  return landTerrains[index % landTerrains.length];
}
/** Broad Champlain Valley-inspired lowlands and eastern ridges, not tile-sized GIS.
 * Keep IDs/coordinates and inherited wind terrain fixed; see docs/across-the-valley.md.
 */
const authoredTerrain: Readonly<Partial<Record<TerritoryTileId, TerrainType>>> =
  {
    "champlain:site-1": "plains",
    "champlain:site-2": "plains",
    "champlain:site-3": "plains",
    "champlain:site-4": "plains",
    "champlain:site-5": "plains",
    "champlain:site-6": "plains",
    "champlain:site-7": "plains",
    "champlain:site-12": "plains",
    "champlain:site-13": "plains",
    "green-uplands:site-2": "plains",
    "green-uplands:site-3": "plains",
    "green-uplands:site-6": "plains",
    "valley-electric:site-3": "mountain",
    "valley-electric:site-8": "mountain",
    "ridge-electric:site-10": "mountain",
  };
const tiles: TerritoryTileDefinition[] = [];
// Relative positions follow the Vermont municipal map. The art tiers reflect
// 2020 populations; the fictional utilities' service areas keep their own loads.
const settlements: Partial<
  Record<TerritoryId, { name: string; size: CitySizeType }>
> = {
  champlain: { name: "Burlington", size: "large" },
  "valley-electric": { name: "Winooski", size: "small" },
  "ridge-electric": { name: "Williston", size: "medium" },
  "parcel-1": { name: "Vergennes", size: "small" },
  "parcel-5": { name: "Waterbury", size: "small" },
  "parcel-9": { name: "Bristol", size: "small" },
  "parcel-11": { name: "Middlebury", size: "medium" },
};
const neutralPosition = { index: 0 };
for (const territory of TERRITORIES) {
  const utility =
    territory.id === "champlain" ||
    territory.id === "valley-electric" ||
    territory.id === "ridge-electric"
      ? UTILITY_AREAS[territory.id]
      : undefined;
  const positions = utility
    ? utilityCoordinates[utility.id]
    : territory.id === "green-uplands"
      ? greenCoordinates
      : neutralCoordinates;
  const cursor =
    utility || territory.id === "green-uplands"
      ? { index: 0 }
      : neutralPosition;
  const next = () => positions[cursor.index++];
  if (
    utility ||
    territory.benefit === "residential" ||
    territory.benefit === "industrial"
  ) {
    tiles.push({
      id: `${territory.id}:city`,
      territoryId: territory.id,
      ...next(),
      // Valley's city and inherited river plant share reciprocal channel edges.
      terrain: territory.id === "valley-electric" ? "river" : "plains",
      city: settlements[territory.id] ?? {
        size: citySizeForTerritory(territory.id),
      },
    });
  }
  let index = 0;
  const inherited = [...(utility?.facilities ?? [])];
  const addSite = (
    siteKind: TerritorySiteKind,
    maxPeakW: number,
    terrain: TerrainType,
    asset?: (typeof inherited)[number],
  ) => {
    const id: TerritoryTileId = `${territory.id}:site-${index++}`;
    tiles.push({
      id,
      territoryId: territory.id,
      ...next(),
      terrain: authoredTerrain[id] ?? terrain,
      siteKind,
      maxPeakW,
      ...(asset?.assetId ? { startingAssetId: asset.assetId } : {}),
      ...(asset?.hydroSiteId
        ? { hydroSiteId: asset.hydroSiteId }
        : siteKind === "hydro"
          ? { hydroSiteId: territoryHydroSiteId(territory.id) }
          : {}),
    });
  };
  // Inherited hydro has its own consumed named site, separate from ordinary budgets.
  for (const asset of inherited.filter((asset) => asset.fuel === "Hydro"))
    addSite(
      "hydro",
      asset.peakW ?? 0,
      utility?.id === "champlain" ? "lake" : "river",
      asset,
    );
  for (const siteKind of [
    "industrial",
    "wind",
    "open-land",
    "general",
    "hydro",
    "geothermal",
  ] as const) {
    const matching = inherited.filter((asset) =>
      siteKind === "wind"
        ? asset.fuel === "Wind"
        : siteKind === "industrial"
          ? asset.fuel !== "Hydro" && asset.fuel !== "Wind"
          : false,
    );
    for (let slot = 0; slot < territory.sites[siteKind].count; slot++)
      addSite(
        siteKind,
        territory.sites[siteKind].maxPeakW,
        siteTerrain(siteKind, slot),
        matching[slot],
      );
  }
  // This landlocked water is a lake. Old offshore installations retain their own siting record.
  if (territory.id === "champlain") addSite("wind", 150e6, "lake");
}
/** Fictional siting cells; exactly one city OR one construction reservation per cell. */
export const TERRITORY_TILES: readonly TerritoryTileDefinition[] = tiles;
const tilesById: ReadonlyMap<string, TerritoryTileDefinition> = new Map(
  TERRITORY_TILES.map((tile) => [tile.id, tile]),
);
export function getAuthoredTerritoryTile(
  id: unknown,
): TerritoryTileDefinition | undefined {
  return typeof id === "string" ? tilesById.get(id) : undefined;
}

const tilesByCoordinates = new Map(
  TERRITORY_TILES.map((tile) => [`${tile.q},${tile.r}`, tile]),
);
export function territoryTileAt(
  q: number,
  r: number,
): TerritoryTileDefinition | undefined {
  const authored = tilesByCoordinates.get(`${q},${r}`);
  if (authored) return authored;
  const id = frontierTerritoryId(q, r);
  const territory = getTerritoryDefinition(id);
  if (!id || !territory) return undefined;
  if (territory.benefit === "residential" || territory.benefit === "industrial")
    return {
      id,
      territoryId: id,
      q,
      r,
      terrain: "plains",
      city: { size: citySizeForTerritory(id) },
    };
  const siteKind =
    territory.benefit === "hydro"
      ? "hydro"
      : territory.benefit === "geothermal"
        ? "geothermal"
        : "general";
  // Three-cell terrain patches soften individual noise without platform-specific functions.
  const terrain =
    landTerrains[
      territoryCoordinateHash(
        Math.floor(q / 3),
        Math.floor(r / 3),
        "terrain-v1",
      ) % landTerrains.length
    ];
  return {
    id,
    territoryId: id,
    q,
    r,
    terrain:
      siteKind === "hydro"
        ? "lake"
        : siteKind === "geothermal"
          ? "mountain"
          : terrain,
    siteKind,
    maxPeakW: territory.sites[siteKind].maxPeakW,
    ...(siteKind === "hydro" ? { hydroSiteId: territoryHydroSiteId(id) } : {}),
  };
}
export function getGeneratedTerritoryTile(
  id: unknown,
): TerritoryTileDefinition | undefined {
  const coordinates = frontierCoordinates(id);
  if (!coordinates) return undefined;
  const tile = territoryTileAt(coordinates.q, coordinates.r);
  return tile?.id === id ? tile : undefined;
}

/** Across the Valley has a fixed board. Keep the coordinate generator for older saves. */
export const VALLEY_BOARD: readonly TerritoryTileDefinition[] = Array.from(
  { length: 13 },
  (_, row) =>
    Array.from({ length: 17 }, (_, column) => ({
      q: column - 8,
      r: row - 6,
    })).flatMap(({ q, r }) =>
      q + r >= -10 && q + r <= 9 ? [territoryTileAt(q, r)!] : [],
    ),
).flat();
const valleyBoardIds = new Set(VALLEY_BOARD.map(({ id }) => id));

export const isValleyBoardTile = (id: TerritoryTileId) =>
  valleyBoardIds.has(id);
