import { getScenario } from "../data/Scenarios";
import { forecastMonthClosingCashAtCustomerRate } from "../reducers/Game";
import { GameType } from "../Types";
import { publicRateCap } from "./Customers";

export const LOW_CASH_THRESHOLD = 100_000;
// A hundredth of a cent: round upwards so the displayed price is the accepted price.
const RATE_STEP = 0.0001;

export function lowCashRateQuote(game: GameType) {
  const scenario = getScenario(game.scenarioId, game.customScenario);
  const capped = scenario?.ownership === "Public" && !scenario.tutorialSteps;
  const maximum = capped
    ? publicRateCap(
        scenario.dollarsPerkWh,
        game.date,
        game.startingYear,
        game.seed,
      )
    : 100;
  const closingCash = (rate: number) =>
    forecastMonthClosingCashAtCustomerRate(game, rate);
  const projectedCash = closingCash(game.dollarsPerkWh);
  const maximumUnits = Math.floor(maximum / RATE_STEP);
  let low = Math.floor(game.dollarsPerkWh / RATE_STEP);
  let high = Math.min(maximumUnits, low + 1);
  // Expand the bracket, then find the smallest quoted increase that leaves positive cash.
  // Re-run the real forecast for each price: a revenue-only ratio misses customer switching.
  while (high > low && closingCash(high * RATE_STEP) < 1) {
    low = high;
    high = Math.min(maximumUnits, Math.max(high + 1, high * 2));
  }
  if (high <= low) return { dollarsPerkWh: null, projectedCash, capped };
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (closingCash(middle * RATE_STEP) >= 1) high = middle;
    else low = middle;
  }
  return {
    dollarsPerkWh: Number((high * RATE_STEP).toFixed(4)),
    projectedCash,
    capped,
  };
}
