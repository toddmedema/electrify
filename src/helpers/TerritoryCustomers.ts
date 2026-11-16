import type { GameType, TerritoryId } from "../Types";
import { LAND_TERRITORIES } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { CUSTOMER_MARKET_MULTIPLIER, customerMarketSizeAt } from "./Customers";

export function landCustomerProfiles(
  game: Pick<GameType, "territoryNetwork">,
  minute = Infinity,
) {
  return LAND_TERRITORIES.filter(
    (territory) =>
      (territory.customers ?? 0) > 0 &&
      game.territoryNetwork?.landPurchases.some(
        (receipt) =>
          receipt.territoryId === territory.id && receipt.minute <= minute,
      ),
  ).map((territory) => ({
    id: territory.id as TerritoryId,
    customers: territory.customers!,
    demandScale:
      UTILITY_AREAS.champlain.demandScale *
      (territory.customerLoadMultiplier ?? 1),
    demandShapeExponent: UTILITY_AREAS.champlain.demandShapeExponent,
    energyShares: {
      Residential: territory.benefit === "residential" ? 1 : 0,
      Commercial: 0,
      Industrial: territory.benefit === "industrial" ? 1 : 0,
    },
  }));
}
export function landCustomerMarket(game: Pick<GameType, "territoryNetwork">) {
  return landCustomerProfiles(game).reduce(
    (sum, area) => sum + area.customers * CUSTOMER_MARKET_MULTIPLIER,
    0,
  );
}
export function landTransferredCustomerTotal(
  game: Pick<GameType, "territoryNetwork">,
  beforeMinute = Infinity,
) {
  return (game.territoryNetwork?.landPurchases ?? []).reduce((sum, receipt) => {
    const territory = LAND_TERRITORIES.find(
      ({ id }) => id === receipt.territoryId,
    );
    return (
      sum +
      (receipt.minute < beforeMinute
        ? customerMarketSizeAt(territory?.customers ?? 0, receipt.minute)
        : 0)
    );
  }, 0);
}

/** Exact dated transfer recorded by a parcel purchase, rather than today's growing market. */
export function landTransferredCustomers(
  game: Pick<GameType, "territoryNetwork">,
  id: TerritoryId,
): number {
  const receipt = game.territoryNetwork?.landPurchases.find(
    (entry) => entry.territoryId === id,
  );
  const territory = LAND_TERRITORIES.find((entry) => entry.id === id);
  return receipt
    ? customerMarketSizeAt(territory?.customers ?? 0, receipt.minute)
    : 0;
}
