import { GAME_TO_REAL_YEARS, TICKS_PER_YEAR, TICK_MINUTES } from "../Constants";
import { effectiveCorridor, effectiveMarket } from "../data/IntertieAccess";
import { GameType, TickPresentFutureType } from "../Types";
import {
  adjacentMarketPricePerMWh,
  allocateIntertieFlows,
  allowsImports,
  intertieContextForGame,
  intertieImportLimitW,
  neighborImportSupplyW,
  transmissionRatingW,
} from "./Transmission";

export interface IntertiePortfolioOutlook {
  shortfallCoverage: number;
  marginalCoverage: number;
  worstGapW: number;
  annualEnergyCost: number;
  additionalEnergyCost: number;
  stressGapW: number;
}
/** Hypothetical commissioned candidate against the current operating fleet, not a promise of construction completion. */
export function intertiePortfolioOutlook(
  game: GameType,
  corridorId: string,
  forecast: readonly TickPresentFutureType[],
  stepMinutes = 60,
  capacityW?: number,
): IntertiePortfolioOutlook | undefined {
  const context = { ...intertieContextForGame(game), expectedLuck: true };
  const corridor = effectiveCorridor(corridorId, context);
  if (!corridor || !forecast.length) return undefined;
  const existing = (game.transmission?.lines || []).filter(
    (line) => line.yearsToBuildLeft <= 0 && line.corridorId !== corridorId,
  );
  const lines = [
    ...existing,
    { corridorId, capacityW: capacityW ?? corridor.capacityW },
  ];
  const ticks = forecast.filter(
    (t) =>
      t.minute >= game.date.minute &&
      t.minute < game.date.minute + TICKS_PER_YEAR * TICK_MINUTES,
  );
  let shortfall = 0,
    supplied = 0,
    additional = 0,
    energyCost = 0,
    additionalCost = 0,
    worstGapW = 0,
    stressGapW = 0;
  const hours = (stepMinutes / 60) * GAME_TO_REAL_YEARS;
  for (const tick of ticks) {
    const local = tick.supplyW - (tick.importedW || 0) + (tick.exportedW || 0);
    const gap = Math.max(0, tick.demandW - local);
    const offers = lines.map((line) => {
      const market = effectiveMarket(line.corridorId, context);
      const marketImportLimitW = neighborImportSupplyW(
        line.corridorId,
        context,
        tick.minute,
        tick,
      );
      return {
        marketId: market?.id,
        marketImportLimitW,
        importLimitW: intertieImportLimitW(line, context, tick.minute, tick),
        exportLimitW: 0,
        pricePerMWh: adjacentMarketPricePerMWh(
          line.corridorId,
          context,
          tick.minute,
          tick,
        ),
        rating: transmissionRatingW(line, tick),
      };
    });
    const need = allowsImports(game.transmission?.tradingPolicy || "BALANCED")
      ? gap
      : 0;
    const baseline = allocateIntertieFlows(
      offers.slice(0, -1),
      need,
      0,
    ).importedW;
    const flows = allocateIntertieFlows(offers, need, 0).importedW;
    const total = flows.reduce((s, w) => s + w, 0);
    const before = baseline.reduce((s, w) => s + w, 0);
    const cost = flows.reduce(
      (s, w, i) => s + (w / 1e6) * offers[i].pricePerMWh,
      0,
    );
    const previousCost = baseline.reduce(
      (s, w, i) => s + (w / 1e6) * offers[i].pricePerMWh,
      0,
    );
    const stressed = allocateIntertieFlows(
      offers.map((o) => ({
        ...o,
        marketImportLimitW: o.marketImportLimitW * 0.5,
        importLimitW: Math.min(o.rating, o.marketImportLimitW * 0.5),
      })),
      need,
      0,
    ).importedW.reduce((s, w) => s + w, 0);
    shortfall += gap * hours;
    supplied += total * hours;
    additional += (total - before) * hours;
    energyCost += cost * hours;
    additionalCost += (cost - previousCost) * hours;
    worstGapW = Math.max(worstGapW, gap - total);
    stressGapW = Math.max(stressGapW, gap - stressed);
  }
  return {
    shortfallCoverage: shortfall ? supplied / shortfall : 1,
    marginalCoverage: shortfall ? additional / shortfall : 0,
    worstGapW,
    annualEnergyCost: energyCost,
    additionalEnergyCost: additionalCost,
    stressGapW,
  };
}

/** Structural decision state; ticking readings alone do not rebuild the two-year outlook. */
export function intertieForecastKey(game: GameType): string {
  return JSON.stringify([
    game.date.monthsElapsed,
    game.location.id,
    game.seed,
    game.scenarioId,
    game.customScenario,
    game.dollarsPerkWh,
    game.startingDemandScale,
    game.loadAdditions,
    game.worldEvents,
    game.storyEffectsDisabled,
    game.policies,
    game.tutorialIntertieStress?.active,
    game.transmission?.tradingPolicy,
    game.facilities.map((f) => [
      f.id,
      f.peakW,
      f.peakWh,
      f.paused,
      f.yearsToBuildLeft > 0,
    ]),
    game.transmission?.lines.map((l) => [
      l.id,
      l.capacityW,
      l.yearsToBuildLeft > 0,
    ]),
  ]);
}
