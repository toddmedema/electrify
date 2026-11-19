import {
  isStorage,
  type FacilityOperatingType,
  type FacilityShoppingType,
  type GameType,
  type TerrainType,
  type LegacyTerritoryTile,
  type TerritoryId,
  type TerritoryTileId,
} from "../Types";
import {
  TERRITORIES,
  purchasedLandTerritories,
  isLandTerritoryId,
  type TerritorySiteKind,
} from "../data/Territories";
import {
  TERRITORY_TILES,
  VALLEY_BOARD,
  getAuthoredTerritoryTile,
  getGeneratedTerritoryTile,
  territoryTileAt,
  type TerritoryTileDefinition,
} from "../data/TerritoryTiles";
import {
  POWER_AGREEMENT_BLOCKS,
  UTILITY_AREAS,
} from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";
import { terrainBuildingPowerLimit } from "./TerritoryCapacity";

export function hasTerritoryNetwork(
  game: Pick<GameType, "scenarioId" | "customScenario" | "territoryNetwork">,
): boolean {
  return isUtilityExpansionGame(game) && game.territoryNetwork?.version === 3;
}
export function ownedTerritories(game: GameType): TerritoryId[] {
  if (!hasTerritoryNetwork(game)) return ["champlain"];
  return [
    ...TERRITORIES.filter(
      ({ id }) =>
        id === "champlain" ||
        (!isLandTerritoryId(id) &&
          game.utilityExpansion?.acquisitions.some(
            ({ targetId }) => targetId === id,
          )),
    ),
    ...purchasedLandTerritories(game),
  ].map(({ id }) => id);
}
export function facilityTerritoryId(
  facility: Pick<FacilityOperatingType, "territoryId" | "startingAssetId">,
): TerritoryId {
  return (
    facility.territoryId ??
    Object.values(UTILITY_AREAS).find((area) =>
      area.facilities.some(
        ({ assetId }) => assetId === facility.startingAssetId,
      ),
    )?.id ??
    "champlain"
  );
}
type SiteTechnology = Pick<FacilityShoppingType, "fuel" | "peakWh"> &
  Partial<Pick<FacilityShoppingType, "name">>;

export function territorySiteKind(
  facility: SiteTechnology,
): Exclude<TerritorySiteKind, "general"> {
  if (isStorage(facility)) return "open-land";
  if (facility.fuel === "Hydro") return "hydro";
  if (facility.fuel === "Geothermal" && facility.name !== "Enhanced Geothermal")
    return "geothermal";
  if (
    facility.fuel === "Wind" ||
    facility.fuel === "Offshore Wind" ||
    facility.fuel === "Airborne Wind"
  )
    return "wind";
  return facility.fuel === "Sun" ? "open-land" : "industrial";
}
const water = (terrain: TerrainType) =>
  terrain === "river" || terrain === "lake" || terrain === "ocean";
/** Legacy industrial/wind/open-land labels describe ordinary land, not exclusive technologies. */
export function isGeneralBuildingLand(tile: TerritoryTileDefinition): boolean {
  return (
    !tile.city &&
    !water(tile.terrain) &&
    tile.siteKind !== "hydro" &&
    tile.siteKind !== "geothermal"
  );
}
/** Catalogue compatibility ignores selected size, ownership, occupancy and affordability. */
export function tileSupportsFacilityTechnology(
  tile: TerritoryTileDefinition,
  facility: SiteTechnology,
): boolean {
  if (tile.city) return false;
  if (tile.terrain === "ocean")
    return (
      !isStorage(facility) &&
      facility.fuel === "Offshore Wind" &&
      tile.siteKind === "wind"
    );
  if (facility.fuel === "Offshore Wind") return false;
  const kind = territorySiteKind(facility);
  if (water(tile.terrain)) return kind === "hydro" && tile.siteKind === "hydro";
  return (
    tile.siteKind === kind ||
    (isGeneralBuildingLand(tile) && kind !== "hydro" && kind !== "geothermal")
  );
}
/** Technology-specific siting allowance; omitted technology reports physical inventory. */
export function territoryTilePowerLimit(
  tile: TerritoryTileDefinition,
  facility?: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): number {
  return tile.city
    ? 0
    : isGeneralBuildingLand(tile)
      ? terrainBuildingPowerLimit(tile.terrain, facility)
      : tile.maxPeakW;
}
/** Retained EGS installations predate the switch from named resources to ordinary land. */
export function isRetainedEnhancedGeothermalSite(
  tile: TerritoryTileDefinition,
  facility: SiteTechnology,
): boolean {
  return (
    !tile.city &&
    tile.siteKind === "geothermal" &&
    !isStorage(facility) &&
    facility.fuel === "Geothermal" &&
    facility.name === "Enhanced Geothermal"
  );
}
/** Technology eligibility and one-site power limits are separate from ownership/occupancy. */
export function tileFitsFacility(
  tile: TerritoryTileDefinition,
  facility: SiteTechnology & Pick<FacilityShoppingType, "peakW">,
  allowHistoricalSize = false,
): boolean {
  return (
    Number.isFinite(facility.peakW) &&
    facility.peakW > 0 &&
    (facility.peakWh === undefined ||
      (Number.isFinite(facility.peakWh) && facility.peakWh > 0)) &&
    (allowHistoricalSize ||
      facility.peakW <= territoryTilePowerLimit(tile, facility)) &&
    (tileSupportsFacilityTechnology(tile, facility) ||
      // Older legal EGS plants used the named geothermal sites. Preserve those placements only.
      (allowHistoricalSize && isRetainedEnhancedGeothermalSite(tile, facility)))
  );
}
/** A retained installation is tied to its original plant ID, not a reusable offshore site. */
export function isRetainedLakeOffshoreFacility(
  game: Pick<GameType, "territoryNetwork">,
  facility: Pick<FacilityOperatingType, "fuel" | "tileId"> &
    Partial<Pick<FacilityOperatingType, "id">>,
): boolean {
  return (
    facility.fuel === "Offshore Wind" &&
    !!game.territoryNetwork?.legacyLakeOffshore?.some(
      ({ facilityId, tileId }) =>
        facilityId === facility.id && tileId === facility.tileId,
    )
  );
}
function historicalTile(
  facility: FacilityOperatingType,
  index: number,
): LegacyTerritoryTile | undefined {
  const territoryId = facilityTerritoryId(facility);
  if (
    territoryId.startsWith("frontier:") ||
    territoryId.startsWith("parcel-") ||
    facility.tileId !== `${territoryId}:legacy-${facility.id}`
  )
    return undefined;
  const kind = territorySiteKind(facility);
  return {
    id: facility.tileId,
    territoryId,
    q: 6 + (index % 4),
    r: -4 + Math.floor(index / 4),
    terrain:
      kind === "hydro"
        ? "lake"
        : kind === "geothermal"
          ? "mountain"
          : facility.fuel === "Offshore Wind"
            ? "ocean"
            : "plains",
    siteKind: kind,
    maxPeakW: facility.peakW,
    ...(facility.hydroSiteId ? { hydroSiteId: facility.hydroSiteId } : {}),
  };
}
type TileGame = Pick<GameType, "facilities"> &
  Partial<
    Pick<
      GameType,
      | "scenarioId"
      | "customScenario"
      | "territoryNetwork"
      | "utilityExpansion"
      | "date"
      | "transmission"
      | "multiplayer"
    >
  >;
type RetainedTileGame = Pick<GameType, "facilities"> &
  Partial<Pick<GameType, "territoryNetwork" | "multiplayer">>;
/** The fallback exists only while upgrading a pre-17 save, before footprints are frozen. */
export function legacyTerritoryTiles(
  game?: RetainedTileGame,
): LegacyTerritoryTile[] {
  return (
    game?.territoryNetwork?.legacyTiles ??
    (game?.facilities ?? [])
      .filter(
        (facility) =>
          typeof facility.tileId === "string" &&
          facility.tileId.includes(":legacy-"),
      )
      .sort((a, b) => a.id - b.id)
      .flatMap((facility, index) => {
        const tile = historicalTile(facility, index);
        return tile ? [tile] : [];
      })
  );
}
function retainedTerritoryTiles(
  game?: RetainedTileGame,
): LegacyTerritoryTile[] {
  // Existing duplicate paid rights survive; the local property wins the foreground at its coordinate.
  return [
    ...(game?.multiplayer?.legacyTiles ?? []).map(({ tile }) => tile),
    ...legacyTerritoryTiles(game),
  ];
}
export function getTerritoryTile(
  id: unknown,
  game?: RetainedTileGame,
): TerritoryTileDefinition | undefined {
  const authored = getAuthoredTerritoryTile(id);
  if (authored) return authored;
  const retained = retainedTerritoryTiles(game);
  const legacy = [...retained].reverse().find((tile) => tile.id === id);
  if (legacy) return legacy;
  const generated = getGeneratedTerritoryTile(id);
  return generated &&
    !retained.some((tile) => tile.q === generated.q && tile.r === generated.r)
    ? generated
    : undefined;
}

type OwnershipGame = Pick<GameType, "territoryNetwork" | "utilityExpansion"> &
  Partial<Pick<GameType, "facilities">>;
/** Short-lived lookup for one view/quote pass; never cached across mutable game updates. */
export function createTerritoryTileOwnership(game: OwnershipGame) {
  const regions = new Set<TerritoryId>([
    "champlain",
    ...(game.utilityExpansion?.acquisitions.map(({ targetId }) => targetId) ??
      []),
    ...(game.territoryNetwork?.landPurchases.map(
      ({ territoryId }) => territoryId,
    ) ?? []),
  ]);
  const cells = new Set(
    game.territoryNetwork?.tilePurchases?.map(({ tileId }) => tileId) ?? [],
  );
  const retained = new Set(
    legacyTerritoryTiles({ ...game, facilities: game.facilities ?? [] }).map(
      (tile) => `${tile.id}:${tile.q}:${tile.r}`,
    ),
  );
  return (tile: TerritoryTileDefinition) =>
    tile.id.includes(":legacy-")
      ? retained.has(`${tile.id}:${tile.q}:${tile.r}`) &&
        regions.has(tile.territoryId)
      : regions.has(tile.territoryId) || cells.has(tile.id);
}
export function ownsTerritoryTile(
  game: OwnershipGame,
  tileOrId: TerritoryTileDefinition | TerritoryTileId,
): boolean {
  const tile =
    typeof tileOrId === "string"
      ? getTerritoryTile(tileOrId, {
          ...game,
          facilities: game.facilities ?? [],
        })
      : tileOrId;
  return !!tile && createTerritoryTileOwnership(game)(tile);
}
export const territoryHexDistance = (
  a: { q: number; r: number },
  b: { q: number; r: number },
) =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
/** Purchase frontiers use physical company property; remote visibility never grants adjacency. */
export function ownedTerritoryTiles(
  game: TileGame,
  owns = createTerritoryTileOwnership(game),
): TerritoryTileDefinition[] {
  return [
    ...TERRITORY_TILES,
    ...legacyTerritoryTiles(game),
    ...(game.territoryNetwork?.tilePurchases ?? []).flatMap(({ tileId }) => {
      const tile = getTerritoryTile(tileId, game);
      return tile ? [tile] : [];
    }),
  ].filter(owns);
}
/** Index physical property once per quote pass; each candidate checks only six neighbors. */
export function createTerritoryTileAdjacency(
  owned: readonly TerritoryTileDefinition[],
) {
  const coordinates = new Set(owned.map(({ q, r }) => `${q},${r}`));
  return ({ q, r }: TerritoryTileDefinition) =>
    coordinates.has(`${q + 1},${r}`) ||
    coordinates.has(`${q - 1},${r}`) ||
    coordinates.has(`${q},${r + 1}`) ||
    coordinates.has(`${q},${r - 1}`) ||
    coordinates.has(`${q + 1},${r - 1}`) ||
    coordinates.has(`${q - 1},${r + 1}`);
}
export function isAdjacentToOwnedTerritoryTile(
  game: TileGame,
  tile: TerritoryTileDefinition,
  owned = ownedTerritoryTiles(game),
): boolean {
  return createTerritoryTileAdjacency(owned)(tile);
}
/** Peer claims only extend sight through a real, operating link, projected by the host. */
export function connectedPeerTerritoryTiles(
  game: TileGame,
): TerritoryTileDefinition[] {
  const connected = new Set(
    (game.multiplayer?.peers ?? [])
      .filter(
        (peer) =>
          !peer.retired &&
          peer.connected !== false &&
          game.transmission?.lines.some(
            (line) =>
              line.corridorId === peer.corridor.id &&
              !line.paused &&
              line.yearsToBuildLeft <= 0 &&
              line.capacityW > 0 &&
              line.minuteCreated <= (game.date?.minute ?? 0),
          ),
      )
      .map((peer) => peer.id),
  );
  return [
    ...new Map([
      ...(game.multiplayer?.peers ?? []).flatMap((peer) =>
        connected.has(peer.id)
          ? (peer.territoryTileIds ?? []).flatMap((id) => {
              const tile = getTerritoryTile(id, game);
              return tile ? [[tile.id, tile] as const] : [];
            })
          : [],
      ),
      ...(game.multiplayer?.legacyTiles ?? []).flatMap(({ tile, seat }) =>
        connected.has(seat) ? [[`${tile.q},${tile.r}`, tile] as const] : [],
      ),
      ...Object.entries(game.multiplayer?.tileOwners ?? {}).flatMap(
        ([id, owner]) => {
          const tile = getTerritoryTile(id, game);
          return tile && owner && connected.has(owner.seat)
            ? [[tile.id, tile] as const]
            : [];
        },
      ),
      ...TERRITORY_TILES.filter((tile) => {
        const owner = isLandTerritoryId(tile.territoryId)
          ? game.multiplayer?.landOwners?.[tile.territoryId]
          : undefined;
        return owner && connected.has(owner.seat);
      }).map((tile) => [tile.id, tile] as const),
    ]).values(),
  ];
}
/** Owned cells, connected peer land and in-force utility PPAs anchor sight. */
export function territoryVisibilityAnchors(
  game: TileGame,
): TerritoryTileDefinition[] {
  const remote = new Set<TerritoryId>(
    (game.transmission?.acceptedAgreements ?? []).flatMap((receipt) => {
      const block = POWER_AGREEMENT_BLOCKS.find(
        ({ id }) => id === receipt.blockId,
      );
      return block &&
        "sellerUtilityId" in block &&
        game.date &&
        receipt.startMinute <= game.date.minute &&
        game.date.minute < receipt.endMinute &&
        !game.utilityExpansion?.acquisitions.some(
          ({ targetId }) => targetId === block.sellerUtilityId,
        )
        ? [block.sellerUtilityId]
        : [];
    }),
  );
  const owns = createTerritoryTileOwnership(game);
  const retained = [
    ...TERRITORY_TILES,
    ...legacyTerritoryTiles(game),
    ...(game.territoryNetwork?.tilePurchases ?? []).flatMap(({ tileId }) => {
      const tile = getTerritoryTile(tileId, game);
      return tile ? [tile] : [];
    }),
  ];
  const peers = connectedPeerTerritoryTiles(game);
  return [
    ...new Map(
      [
        ...retained.filter(
          (tile) => owns(tile) || remote.has(tile.territoryId),
        ),
        ...peers,
      ].map((tile) => [`${tile.q},${tile.r}`, tile]),
    ).values(),
  ];
}
export function territoryVisibilityDistance(
  game: TileGame,
  tile: TerritoryTileDefinition,
): 0 | 1 | 2 | 3 | undefined {
  const distance = Math.min(
    Infinity,
    ...territoryVisibilityAnchors(game).map((anchor) =>
      territoryHexDistance(anchor, tile),
    ),
  );
  return distance <= 3 ? (distance as 0 | 1 | 2 | 3) : undefined;
}
export interface VisibleTerritoryTile {
  tile: TerritoryTileDefinition;
  visibilityDistance: 0 | 1 | 2 | 3;
}
/** Work grows by 37 cells per anchor, without comparing every tile to every anchor. */
export function visibleTerritoryTiles(game: TileGame): VisibleTerritoryTile[] {
  const result = new Map<string, VisibleTerritoryTile>();
  const retainedAt = new Map(
    retainedTerritoryTiles(game).map((tile) => [`${tile.q},${tile.r}`, tile]),
  );
  for (const anchor of territoryVisibilityAnchors(game)) {
    for (let dq = -3; dq <= 3; dq++)
      for (let dr = Math.max(-3, -dq - 3); dr <= Math.min(3, -dq + 3); dr++) {
        const q = anchor.q + dq,
          r = anchor.r + dr;
        const key = `${q},${r}`;
        const visibilityDistance = Math.max(
          Math.abs(dq),
          Math.abs(dr),
          Math.abs(dq + dr),
        ) as 0 | 1 | 2 | 3;
        const existing = result.get(key);
        if (existing && existing.visibilityDistance <= visibilityDistance)
          continue;
        const tile = retainedAt.get(key) ?? territoryTileAt(q, r);
        if (tile) result.set(key, { tile, visibilityDistance });
      }
  }
  return [...result.values()];
}
/** The scenario board is visible immediately. Retained sites outside it keep their footprints. */
export function scenarioMapTiles(game: TileGame): VisibleTerritoryTile[] {
  const key = ({ q, r }: TerritoryTileDefinition) => `${q},${r}`;
  const owned = ownedTerritoryTiles(game);
  const mapped = new Map(VALLEY_BOARD.map((tile) => [key(tile), tile]));
  for (const tile of retainedTerritoryTiles(game)) mapped.set(key(tile), tile);
  for (const tile of connectedPeerTerritoryTiles(game))
    mapped.set(key(tile), tile);
  for (const tile of owned) mapped.set(key(tile), tile);

  const distances = new Map<string, 0 | 1 | 2>();
  for (const anchor of owned)
    for (let dq = -2; dq <= 2; dq++)
      for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
        const coordinate = `${anchor.q + dq},${anchor.r + dr}`;
        const distance = Math.max(
          Math.abs(dq),
          Math.abs(dr),
          Math.abs(dq + dr),
        ) as 0 | 1 | 2;
        if (distance < (distances.get(coordinate) ?? 3))
          distances.set(coordinate, distance);
      }
  return Array.from(mapped, ([coordinate, tile]) => ({
    tile,
    visibilityDistance: distances.get(coordinate) ?? 3,
  }));
}

/** Catalogue for the current scenario, including previously retained placements. */
export function getTerritoryTiles(
  game?: TileGame,
): readonly TerritoryTileDefinition[] {
  if (!game) return TERRITORY_TILES;
  return [
    ...new Map(
      [
        ...TERRITORY_TILES,
        ...legacyTerritoryTiles(game),
        ...scenarioMapTiles(game).map(({ tile }) => tile),
      ].map((tile) => [tile.id, tile]),
    ).values(),
  ];
}
export function isTerritoryTileId(
  value: unknown,
  game?: RetainedTileGame,
): value is TerritoryTileId {
  return !!getTerritoryTile(value, game);
}
export function getFacilityTile(
  facility: Pick<FacilityOperatingType, "tileId" | "startingAssetId">,
  game?: RetainedTileGame,
): TerritoryTileDefinition | undefined {
  return facility.tileId
    ? getTerritoryTile(facility.tileId, game)
    : TERRITORY_TILES.find(
        (tile) =>
          !!facility.startingAssetId &&
          tile.startingAssetId === facility.startingAssetId,
      );
}
export const facilityTileId = (
  facility: Pick<FacilityOperatingType, "tileId" | "startingAssetId">,
): TerritoryTileId | undefined =>
  facility.tileId ?? getFacilityTile(facility)?.id;
export function facilityOnTile(
  game: Pick<GameType, "facilities">,
  id: TerritoryTileId,
): FacilityOperatingType | undefined {
  return game.facilities.find((facility) => facilityTileId(facility) === id);
}
function tileReserved(
  game: Pick<GameType, "facilities"> &
    Partial<Pick<GameType, "commissionedHydroSiteIds">>,
  tile: TerritoryTileDefinition,
) {
  return (
    !!facilityOnTile(game, tile.id) ||
    (!!tile.hydroSiteId &&
      !!game.commissionedHydroSiteIds?.includes(tile.hydroSiteId))
  );
}
/** Physical inventory stays available for a too-large quote so the UI can offer a smaller size. */
export function territoryTileInventory(
  game: Pick<GameType, "facilities"> &
    Partial<Pick<GameType, "commissionedHydroSiteIds">>,
  id: unknown,
  facility?: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): { remaining: number; total: number; maxPeakW: number } {
  const tile = getTerritoryTile(id, game);
  if (!tile || tile.city) return { remaining: 0, total: 0, maxPeakW: 0 };
  return {
    remaining: tileReserved(game, tile) ? 0 : 1,
    total: 1,
    maxPeakW: territoryTilePowerLimit(tile, facility),
  };
}
export function availableTerritoryTiles(
  game: GameType,
  facility: FacilityShoppingType,
  id: TerritoryId,
): readonly TerritoryTileDefinition[] {
  return technologyTiles(game, facility, id).filter(
    (tile) => tileFitsFacility(tile, facility) && !tileReserved(game, tile),
  );
}
function technologyTiles(
  game: GameType,
  facility: SiteTechnology,
  id: TerritoryId,
): TerritoryTileDefinition[] {
  const owns = createTerritoryTileOwnership(game);
  return getTerritoryTiles(game).filter(
    (tile) =>
      tile.territoryId === id &&
      owns(tile) &&
      tileSupportsFacilityTechnology(tile, facility),
  );
}

export function territoryFacilityInventory(
  game: GameType,
  facility: FacilityShoppingType,
  id: TerritoryId,
) {
  const compatible = technologyTiles(game, facility, id);
  const free = compatible.filter((tile) => !tileReserved(game, tile));
  return {
    total: compatible.length,
    remaining: free.length,
    maxPeakW: free.reduce(
      (limit, tile) => Math.max(limit, territoryTilePowerLimit(tile, facility)),
      0,
    ),
    available: free.filter((tile) => tileFitsFacility(tile, facility)),
  };
}
/** Assign missing placements only; explicit invalid/duplicate placements are never silently repaired. */
export function assignTerritoryTiles(game: GameType): boolean {
  if (!hasTerritoryNetwork(game)) return true;
  const occupied = new Set<TerritoryTileId>();
  const ordered = [...game.facilities].sort(
    (a, b) =>
      (!!b.startingAssetId ? 1 : 0) - (!!a.startingAssetId ? 1 : 0) ||
      a.id - b.id,
  );
  for (const facility of ordered) {
    const territoryId = facilityTerritoryId(facility);
    const historicalSize =
      !isLandTerritoryId(territoryId) ||
      !!game.territoryNetwork?.landPurchases.some(
        ({ territoryId: id }) => id === territoryId,
      );
    // Retain paid ordinary-land plants when spatial allowances change, including frontier cells.
    const fitsRetained = (tile: TerritoryTileDefinition) =>
      tileFitsFacility(
        tile,
        facility,
        historicalSize ||
          isGeneralBuildingLand(tile) ||
          isRetainedEnhancedGeothermalSite(tile, facility),
      );
    if (facility.tileId !== undefined) {
      const tile = getTerritoryTile(facility.tileId, game);
      if (
        !tile ||
        tile.territoryId !== territoryId ||
        occupied.has(tile.id) ||
        (!fitsRetained(tile) &&
          !(
            facility.fuel === "Offshore Wind" && tile.id === "champlain:site-14"
          ))
      )
        return false;
      occupied.add(tile.id);
      continue;
    }
    const candidates = getTerritoryTiles(game).filter(
      (tile) =>
        tile.territoryId === territoryId &&
        !occupied.has(tile.id) &&
        fitsRetained(tile),
    );
    const tile =
      candidates.find(
        (tile) =>
          !!facility.startingAssetId &&
          tile.startingAssetId === facility.startingAssetId,
      ) ?? candidates[0];
    facility.tileId = tile?.id ?? `${territoryId}:legacy-${facility.id}`;
    if (!tile && game.territoryNetwork?.legacyTiles) {
      const retained = historicalTile(
        facility,
        game.territoryNetwork.legacyTiles.length,
      );
      if (!retained) return false;
      game.territoryNetwork.legacyTiles.push(retained);
    }
    occupied.add(facility.tileId);
  }
  return true;
}
export function territorySiteInventory(
  game: TileGame & Partial<Pick<GameType, "commissionedHydroSiteIds">>,
  id: TerritoryId,
  kind: TerritorySiteKind,
  facility?: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): { remaining: number; total: number; maxPeakW: number } {
  const tiles = getTerritoryTiles(game).filter(
    (tile) =>
      tile.territoryId === id &&
      tile.siteKind === kind &&
      ownsTerritoryTile(game, tile),
  );
  return {
    total: tiles.length,
    remaining: tiles.filter((tile) => !tileReserved(game, tile)).length,
    maxPeakW: Math.max(
      0,
      ...tiles.map((tile) => territoryTilePowerLimit(tile, facility)),
    ),
  };
}
