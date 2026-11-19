import { TICK_MINUTES, YEARS_PER_TICK } from "../Constants";
import type { FacilityShoppingType, GameType, TerritoryTileId } from "../Types";
import { getDateFromMinute } from "./DateTime";
import { facilityLoanMonths, purchaseTerms } from "./Financials";

/** Compare the terms a player approved with the quote the host can actually execute. */
export function facilityConstructionReview(
  game: GameType,
  facility: FacilityShoppingType,
  financed: boolean,
  tileId?: TerritoryTileId,
) {
  const interestRate = financed ? game.interestRate : 0;
  const loanMonths = facilityLoanMonths(facility.lifespanYears);
  const terms = purchaseTerms(
    facility.buildCost,
    financed,
    interestRate,
    0,
    loanMonths,
  );
  // A month-boundary pre-roll can commission a project just before its estimated month.
  const online = getDateFromMinute(
    game.date.minute +
      Math.ceil(facility.yearsToBuild / YEARS_PER_TICK) * TICK_MINUTES,
    game.startingYear,
  );
  const key = JSON.stringify([
    tileId,
    facility.name,
    facility.gasCycle,
    facility.peakW,
    facility.peakWh,
    facility.buildCost,
    facility.annualOperatingCost,
    facility.yearsToBuild,
    online.year,
    online.month,
    financed,
    interestRate,
    financed ? loanMonths : undefined,
    !!facility.resilience?.coldWeatherPackage,
    !!facility.resilience?.solarTrackers,
  ]);
  return { key, terms, online };
}
