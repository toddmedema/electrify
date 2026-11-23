import type { GameType, TerritoryId } from "../Types";
import {
  getTerritoryDefinition,
  purchasedLandTerritories,
} from "../data/Territories";
import { cityCustomerCount, cityProfile } from "./CityProfiles";
import { CUSTOMER_MARKET_MULTIPLIER, customerMarketSizeAt } from "./Customers";

export function landCustomerProfiles(
  game: Pick<GameType, "territoryNetwork" | "seed"> &
    Partial<Pick<GameType, "date">>,
  minute = game.date?.minute ?? Infinity,
) {
  return purchasedLandTerritories(game, minute)
    .filter(
      (territory) =>
        (territory.customers ?? 0) > 0 &&
        landCustomerReceipts(game).some(
          (receipt) =>
            receipt.territoryId === territory.id && receipt.minute <= minute,
        ),
    )
    .flatMap(({ id }) => {
      const profile = cityProfile(game.seed, id);
      return profile ? [profile] : [];
    });
}
export function landCustomerMarket(
  game: Pick<GameType, "territoryNetwork" | "date">,
) {
  return purchasedLandTerritories(game, game.date.minute).reduce(
    (sum, area) =>
      sum + cityCustomerCount(area.id) * CUSTOMER_MARKET_MULTIPLIER,
    0,
  );
}
export function landCustomerReceipts(game: Pick<GameType, "territoryNetwork">) {
  return [
    ...(game.territoryNetwork?.landPurchases ?? []),
    ...(game.territoryNetwork?.tilePurchases ?? []).flatMap((receipt) => {
      const id = receipt.tileId.startsWith("frontier:")
        ? receipt.tileId
        : receipt.tileId.split(":")[0];
      const territory = getTerritoryDefinition(id);
      return territory
        ? [
            {
              ...receipt,
              minute: receipt.connectionMinute ?? receipt.minute,
              territoryId: territory.id,
            },
          ]
        : [];
    }),
  ];
}
export function landTransferredCustomerTotal(
  game: Pick<GameType, "territoryNetwork">,
  beforeMinute = Infinity,
) {
  return landCustomerReceipts(game).reduce(
    (sum, receipt) =>
      sum +
      (receipt.minute < beforeMinute
        ? customerMarketSizeAt(
            cityCustomerCount(receipt.territoryId),
            receipt.minute,
          )
        : 0),
    0,
  );
}
/** Exact dated city transfer, credited once by its physical purchase or retained old receipt. */
export function landTransferredCustomers(
  game: Pick<GameType, "territoryNetwork" | "date">,
  id: TerritoryId,
): number {
  const receipt = landCustomerReceipts(game).find(
    (entry) => entry.territoryId === id && entry.minute <= game.date.minute,
  );
  return receipt
    ? customerMarketSizeAt(cityCustomerCount(id), receipt.minute)
    : 0;
}
