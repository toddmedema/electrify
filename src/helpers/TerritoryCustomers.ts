import type { GameType, TerritoryId } from "../Types";
import {
  getTerritoryDefinition,
  purchasedLandTerritories,
} from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { CUSTOMER_MARKET_MULTIPLIER, customerMarketSizeAt } from "./Customers";

export function landCustomerProfiles(
  game: Pick<GameType, "territoryNetwork">,
  minute = Infinity,
) {
  return purchasedLandTerritories(game)
    .filter(
      (territory) =>
        (territory.customers ?? 0) > 0 &&
        landReceipts(game).some(
          (receipt) =>
            receipt.territoryId === territory.id && receipt.minute <= minute,
        ),
    )
    .map((territory) => ({
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
function landReceipts(game: Pick<GameType, "territoryNetwork">) {
  return [
    ...(game.territoryNetwork?.landPurchases ?? []),
    ...(game.territoryNetwork?.tilePurchases ?? []).flatMap((receipt) => {
      const id = receipt.tileId.startsWith("frontier:")
        ? receipt.tileId
        : receipt.tileId.split(":")[0];
      const territory = getTerritoryDefinition(id);
      return territory ? [{ ...receipt, territoryId: territory.id }] : [];
    }),
  ];
}
export function landTransferredCustomerTotal(
  game: Pick<GameType, "territoryNetwork">,
  beforeMinute = Infinity,
) {
  return landReceipts(game).reduce(
    (sum, receipt) =>
      sum +
      (receipt.minute < beforeMinute
        ? customerMarketSizeAt(
            getTerritoryDefinition(receipt.territoryId)?.customers ?? 0,
            receipt.minute,
          )
        : 0),
    0,
  );
}
/** Exact dated city transfer, credited once by its physical purchase or retained old receipt. */
export function landTransferredCustomers(
  game: Pick<GameType, "territoryNetwork">,
  id: TerritoryId,
): number {
  const receipt = landReceipts(game).find((entry) => entry.territoryId === id);
  return receipt
    ? customerMarketSizeAt(
        getTerritoryDefinition(id)?.customers ?? 0,
        receipt.minute,
      )
    : 0;
}
