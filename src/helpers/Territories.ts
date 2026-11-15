import {
  isStorage,
  type AcquireLandAction,
  type FacilityOperatingType,
  type FacilityShoppingType,
  type GameType,
  type TerritoryId,
  type TickPresentFutureType,
} from "../Types";
import {
  GREEN_UPLANDS_CORRIDOR_ID,
  TERRITORIES,
  type TerritorySiteKind,
} from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { getDateFromMinute } from "./DateTime";
import { currentTick } from "./GameSelectors";

export function hasTerritoryNetwork(
  game: Pick<GameType, "scenarioId" | "customScenario" | "territoryNetwork">,
): boolean {
  return isUtilityExpansionGame(game) && game.territoryNetwork?.version === 2;
}

export function ownedTerritories(game: GameType): TerritoryId[] {
  if (!hasTerritoryNetwork(game)) return ["champlain"];
  return TERRITORIES.filter(
    ({ id }) =>
      id === "champlain" ||
      (id === "green-uplands"
        ? game.territoryNetwork?.landPurchases.some(
            (receipt) => receipt.territoryId === id,
          )
        : game.utilityExpansion?.acquisitions.some(
            ({ targetId }) => targetId === id,
          )),
  ).map(({ id }) => id);
}

/** Explicit placement wins; old inherited assets retain their authored provenance. */
export function facilityTerritoryId(
  facility: Pick<FacilityOperatingType, "territoryId" | "startingAssetId">,
): TerritoryId {
  if (facility.territoryId) return facility.territoryId;
  return (
    Object.values(UTILITY_AREAS).find((area) =>
      area.facilities.some(
        ({ assetId }) => assetId === facility.startingAssetId,
      ),
    )?.id ?? "champlain"
  );
}

export function territorySiteKind(
  facility: Pick<FacilityShoppingType, "fuel" | "peakWh">,
): TerritorySiteKind | undefined {
  if (isStorage(facility)) return "open-land";
  if (facility.fuel === "Hydro") return undefined;
  if (
    facility.fuel === "Wind" ||
    facility.fuel === "Offshore Wind" ||
    facility.fuel === "Airborne Wind"
  )
    return "wind";
  if (facility.fuel === "Sun") return "open-land";
  return "industrial";
}

/** Reservations include paused and unfinished projects; selling removes the reservation. */
export function territorySiteInventory(
  game: Pick<GameType, "facilities">,
  id: TerritoryId,
  kind: TerritorySiteKind,
): { remaining: number; total: number; maxPeakW: number } {
  const budget = TERRITORIES.find((territory) => territory.id === id)?.sites[
    kind
  ];
  const total = budget?.count ?? 0;
  const used = game.facilities.filter(
    (owned) =>
      facilityTerritoryId(owned) === id && territorySiteKind(owned) === kind,
  ).length;
  return {
    remaining: Math.max(0, total - used),
    total,
    maxPeakW: budget?.maxPeakW ?? 0,
  };
}

export function territoryBuildAvailability(
  game: GameType,
  facility: FacilityShoppingType,
  id: TerritoryId,
): {
  buildable: boolean;
  reason?: string;
  remaining: number;
  maxPeakW: number;
} {
  if (!hasTerritoryNetwork(game))
    return { buildable: true, remaining: Infinity, maxPeakW: Infinity };
  const territory = TERRITORIES.find((territory) => territory.id === id);
  const kind = territorySiteKind(facility);
  const { remaining, maxPeakW } = kind
    ? territorySiteInventory(game, id, kind)
    : { remaining: 0, maxPeakW: 0 };
  const reject = (reason: string) => ({
    buildable: false,
    reason,
    remaining,
    maxPeakW,
  });
  if (!territory) return reject("Choose a valid territory.");
  if (!ownedTerritories(game).includes(id))
    return reject("Acquire this territory before building.");
  if (!kind)
    return reject("No new hydro sites are available in these territories.");
  if (!remaining)
    return reject("No sites of this type remain in this territory.");
  if (!(
    Number.isFinite(facility.peakW) &&
    facility.peakW > 0 &&
    facility.peakW <= maxPeakW
  ))
    return reject("This project exceeds the territory’s per-site power limit.");
  return { buildable: true, remaining, maxPeakW };
}

/** Apportion actual sector demand by inherited customer/load weights; never add another load. */
export function territoryDemandShares(
  game: GameType,
  tick: Pick<TickPresentFutureType, "demandW" | "demandByType" | "minute">,
): Record<TerritoryId, number> {
  const result: Record<TerritoryId, number> = {
    champlain: 0,
    "valley-electric": 0,
    "ridge-electric": 0,
    "green-uplands": 0,
  };
  const areas = Object.values(UTILITY_AREAS).filter(
    ({ id }) =>
      id === "champlain" ||
      (hasTerritoryNetwork(game) &&
        game.utilityExpansion?.acquisitions.some(
          (receipt) => receipt.targetId === id && receipt.minute <= tick.minute,
        )),
  );
  const totalWeight = areas.reduce(
    (sum, area) => sum + area.customers * area.demandScale,
    0,
  );
  for (const [sector, load] of Object.entries(tick.demandByType)) {
    const key =
      sector === "Residential" ||
      sector === "Commercial" ||
      sector === "Industrial"
        ? sector
        : undefined;
    const sectorWeight = areas.reduce(
      (sum, area) =>
        sum +
        area.customers * area.demandScale * (key ? area.energyShares[key] : 1),
      0,
    );
    for (const area of areas)
      result[area.id] +=
        (Math.max(0, load) *
          area.customers *
          area.demandScale *
          (key ? area.energyShares[key] : 1)) /
        sectorWeight;
  }
  const total = Object.values(result).reduce((sum, load) => sum + load, 0);
  for (const area of areas)
    result[area.id] =
      total > 0
        ? (result[area.id] / total) * tick.demandW
        : ((area.customers * area.demandScale) / totalWeight) * tick.demandW;
  // Keep the company total exact despite division roundoff.
  result.champlain +=
    tick.demandW - Object.values(result).reduce((sum, load) => sum + load, 0);
  return result;
}

export function territoryForCorridor(corridorId: string): TerritoryId {
  if (
    corridorId === "vt-valley-regional" ||
    corridorId === "vt-champlain-valley"
  )
    return "valley-electric";
  if (corridorId === "vt-ridge-regional" || corridorId === "vt-champlain-ridge")
    return "ridge-electric";
  if (corridorId === GREEN_UPLANDS_CORRIDOR_ID) return "green-uplands";
  return "champlain";
}

/** Legacy investments retain their exact financed balances, without operating as wires. */
export function legacyTerritoryConnections(
  game: Pick<GameType, "territoryNetwork">,
) {
  return game.territoryNetwork?.legacyConnections ?? [];
}
export const LAND_PRICE_2005 = 18e6;
export function landPrice(
  game: Pick<GameType, "seed" | "startingYear">,
  minute: number,
): number {
  return (
    LAND_PRICE_2005 *
    (hasEconomy()
      ? getInflationIndex(
          getDateFromMinute(minute, game.startingYear),
          2005,
          game.seed,
        )
      : 1)
  );
}
export function landPurchaseQuote(game: GameType) {
  if (
    !hasTerritoryNetwork(game) ||
    ownedTerritories(game).includes("green-uplands") ||
    game.multiplayer?.landOwner
  )
    return undefined;
  const price = landPrice(game, game.date.minute);
  return {
    territoryId: "green-uplands" as const,
    price,
    quoteKey: JSON.stringify(["green-uplands", game.date.minute, price]),
  };
}
export function validLandPurchaseAction(
  game: GameType,
  value: unknown,
): value is AcquireLandAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Partial<AcquireLandAction>;
  const quote = landPurchaseQuote(game);
  return (
    Object.keys(value).length === 2 &&
    action.territoryId === "green-uplands" &&
    !!quote &&
    quote.quoteKey === action.quoteKey
  );
}
export function purchaseLand(game: GameType, value: unknown): boolean {
  if (!validLandPurchaseAction(game, value)) return false;
  const quote = landPurchaseQuote(game)!;
  const now = currentTick(game);
  if (!now || now.cash < quote.price || !game.territoryNetwork) return false;
  now.cash -= quote.price;
  game.territoryNetwork.landPurchases.push({
    territoryId: quote.territoryId,
    minute: game.date.minute,
    price: quote.price,
  });
  // Land is a non-depreciating capital asset; exchanging cash for it preserves net worth.
  return true;
}
