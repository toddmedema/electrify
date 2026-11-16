import {
  isStorage,
  type AcquireLandAction,
  type LandTerritoryId,
  type FacilityOperatingType,
  type FacilityShoppingType,
  type GameType,
  type TerritoryId,
  type TickPresentFutureType,
} from "../Types";
import {
  GREEN_UPLANDS_CORRIDOR_ID,
  TERRITORIES,
  LAND_TERRITORIES,
  isLandTerritoryId,
  territoryHydroSiteId,
  type TerritorySiteKind,
} from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { getDateFromMinute } from "./DateTime";
import { currentTick } from "./GameSelectors";
import { customerMarketSizeAt } from "./Customers";
import { landCustomerProfiles, landCustomerMarket } from "./TerritoryCustomers";
import {
  programCustomers,
  buildoutComplete,
  isOperatingPolicy,
} from "./Policies";

export function hasTerritoryNetwork(
  game: Pick<GameType, "scenarioId" | "customScenario" | "territoryNetwork">,
): boolean {
  return isUtilityExpansionGame(game) && game.territoryNetwork?.version === 3;
}

export function ownedTerritories(game: GameType): TerritoryId[] {
  if (!hasTerritoryNetwork(game)) return ["champlain"];
  return TERRITORIES.filter(
    ({ id }) =>
      id === "champlain" ||
      (isLandTerritoryId(id)
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
  if (facility.fuel === "Hydro") return "hydro";
  if (facility.fuel === "Geothermal") return "geothermal";
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
  const territory = TERRITORIES.find((territory) => territory.id === id);
  const budget = territory?.sites[kind];
  const total = budget?.count ?? 0;
  const used = game.facilities.filter((owned) => {
    if (facilityTerritoryId(owned) !== id) return false;
    const actual = territorySiteKind(owned);
    return (
      actual === kind ||
      (kind === "general" && actual !== "hydro" && actual !== "geothermal")
    );
  }).length;
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
  total: number;
  maxPeakW: number;
} {
  if (!hasTerritoryNetwork(game))
    return {
      buildable: true,
      remaining: Infinity,
      total: Infinity,
      maxPeakW: Infinity,
    };
  const territory = TERRITORIES.find((territory) => territory.id === id);
  const specific = territorySiteKind(facility);
  const kind =
    specific !== "hydro" &&
    specific !== "geothermal" &&
    (territory?.sites.general.count ?? 0) > 0
      ? "general"
      : specific;
  const { remaining, total, maxPeakW } = kind
    ? territorySiteInventory(game, id, kind)
    : { remaining: 0, total: 0, maxPeakW: 0 };
  const reject = (reason: string) => ({
    buildable: false,
    reason,
    remaining,
    total,
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
  return { buildable: true, remaining, total, maxPeakW };
}

/** Apportion actual sector demand by inherited customer/load weights; never add another load. */
export function territoryDemandShares(
  game: GameType,
  tick: Pick<TickPresentFutureType, "demandW" | "demandByType" | "minute">,
): Record<TerritoryId, number> {
  const result = Object.fromEntries(
    TERRITORIES.map(({ id }) => [id, 0]),
  ) as Record<TerritoryId, number>;
  const utilityAreas = Object.values(UTILITY_AREAS).filter(
    ({ id }) =>
      id === "champlain" ||
      (hasTerritoryNetwork(game) &&
        game.utilityExpansion?.acquisitions.some(
          (receipt) => receipt.targetId === id && receipt.minute <= tick.minute,
        )),
  );
  const areas = [...utilityAreas, ...landCustomerProfiles(game, tick.minute)];
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
  id: LandTerritoryId = "green-uplands",
): number {
  return (
    (TERRITORIES.find((territory) => territory.id === id)?.price2005 ??
      LAND_PRICE_2005) *
    (hasEconomy()
      ? getInflationIndex(
          getDateFromMinute(minute, game.startingYear),
          2005,
          game.seed,
        )
      : 1)
  );
}
export function landPurchaseQuote(
  game: GameType,
  id: LandTerritoryId = "green-uplands",
) {
  if (
    !hasTerritoryNetwork(game) ||
    !isLandTerritoryId(id) ||
    ownedTerritories(game).includes(id) ||
    game.multiplayer?.landOwners?.[id]
  )
    return undefined;
  const territory = LAND_TERRITORIES.find((territory) => territory.id === id)!;
  const price = landPrice(game, game.date.minute, id);
  return {
    territoryId: id,
    price,
    benefit: territory.benefit!,
    customers: customerMarketSizeAt(territory.customers ?? 0, game.date.minute),
    quoteKey: JSON.stringify([id, game.date.minute, price]),
  };
}
export function validLandPurchaseAction(
  game: GameType,
  value: unknown,
): value is AcquireLandAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Partial<AcquireLandAction>;
  const quote = isLandTerritoryId(action.territoryId)
    ? landPurchaseQuote(game, action.territoryId)
    : undefined;
  return (
    Object.keys(value).length === 2 &&
    isLandTerritoryId(action.territoryId) &&
    !!quote &&
    quote.quoteKey === action.quoteKey
  );
}
export function purchaseLand(game: GameType, value: unknown): boolean {
  if (!validLandPurchaseAction(game, value)) return false;
  const quote = landPurchaseQuote(game, value.territoryId)!;
  const now = currentTick(game);
  if (!now || now.cash < quote.price || !game.territoryNetwork) return false;
  const oldProgramCustomers = programCustomers(game);
  now.cash -= quote.price;
  now.customers += quote.customers;
  game.territoryNetwork.landPurchases.push({
    territoryId: quote.territoryId,
    minute: game.date.minute,
    price: quote.price,
  });
  if (quote.customers > 0) {
    game.customerMarketSize =
      UTILITY_AREAS.champlain.addressablePool +
      (game.utilityExpansion?.acquisitions.reduce(
        (sum, receipt) => sum + UTILITY_AREAS[receipt.targetId].addressablePool,
        0,
      ) ?? 0) +
      landCustomerMarket(game);
    const ratio = oldProgramCustomers / programCustomers(game);
    for (const [id, program] of Object.entries(game.policies?.programs ?? {})) {
      if (isOperatingPolicy(id as import("../Types").PolicyId)) continue;
      program.adoption *= ratio;
      if (program.installs)
        program.installs = program.installs.map(([month, share]) => [
          month,
          share * ratio,
        ]);
      if (!buildoutComplete(program.adoption)) delete program.completedMonth;
    }
  }
  // Land is a non-depreciating capital asset; exchanging cash for it preserves net worth.
  return true;
}

/** Owned, unreserved fictional special sites; the normal technology owner still prices plants. */
export function territorySpecialSites(
  game: Pick<
    GameType,
    "territoryNetwork" | "facilities" | "commissionedHydroSiteIds"
  >,
  benefit: "hydro" | "geothermal",
  id?: TerritoryId,
) {
  return LAND_TERRITORIES.filter(
    (territory) =>
      territory.benefit === benefit &&
      (!id || territory.id === id) &&
      game.territoryNetwork?.landPurchases.some(
        (receipt) => receipt.territoryId === territory.id,
      ) &&
      !game.facilities.some(
        (facility) =>
          facilityTerritoryId(facility) === territory.id &&
          territorySiteKind(facility) === benefit,
      ) &&
      (benefit !== "hydro" ||
        !game.commissionedHydroSiteIds.includes(
          territoryHydroSiteId(territory.id),
        )),
  );
}

export { landTransferredCustomers } from "./TerritoryCustomers";
