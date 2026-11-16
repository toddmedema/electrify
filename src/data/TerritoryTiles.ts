import type { TerrainType, TerritoryId, TerritoryTileId } from "../Types";
import {
  TERRITORIES,
  territoryHydroSiteId,
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
        city: { sector: "residential" | "industrial" };
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
  champlain: coordinates([-4, -3, -2, -1].map((r) => [r, [-4, -3, -2, -1]])),
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
// Snake order keeps every two-cell neutral parcel adjacent across row boundaries.
const neutralCoordinates = coordinates([
  [2, [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5]],
  [3, [5, 4, 3, 2, 1, 0, -1, -2, -3, -4]],
  [4, [-4, -3, -2, -1, 0, 1, 2, 3]],
]);
const landTerrains: readonly TerrainType[] = [
  "plains",
  "forest",
  "hills",
  "mountain",
];
function siteTerrain(kind: TerritorySiteKind, index: number): TerrainType {
  if (kind === "hydro") return index % 2 ? "river" : "lake";
  if (kind === "geothermal") return "mountain";
  if (kind === "wind")
    return ["hills", "mountain", "plains"][index % 3] as TerrainType;
  if (kind === "open-land")
    return ["plains", "hills", "forest"][index % 3] as TerrainType;
  return landTerrains[index % landTerrains.length];
}
const tiles: TerritoryTileDefinition[] = [];
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
      terrain: "plains",
      city: {
        sector:
          utility?.id === "ridge-electric" || territory.benefit === "industrial"
            ? "industrial"
            : "residential",
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
    tiles.push({
      id: `${territory.id}:site-${index++}`,
      territoryId: territory.id,
      ...next(),
      terrain,
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
        siteTerrain(
          siteKind,
          slot +
            (territory.benefit === "hydro" && territory.id === "parcel-7"
              ? 1
              : 0),
        ),
        matching[slot],
      );
  }
  // An extra ocean site preserves all three existing onshore wind rights.
  if (territory.id === "champlain") addSite("wind", 150e6, "ocean");
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
