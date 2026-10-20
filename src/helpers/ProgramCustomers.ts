import type { GameType } from "../Types";
import { CUSTOMER_MARKET_MULTIPLIER } from "./Customers";

/** Starting utility accounts, scaled exactly like demand rather than the whole market. */
export const programCustomers = (game: GameType) =>
  (game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER) *
  game.startingDemandScale;
