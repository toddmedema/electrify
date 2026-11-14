import { createGame } from "../../testing/Simulator";
import { GENERATORS, STORAGE } from "../../data/Facilities";
import reducer, {
  buildFacility,
  generateForecastTimeline,
  previewFacilityBuild,
} from "../../reducers/Game";
import { TICK_MINUTES, TICKS_PER_YEAR } from "../../Constants";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { computeOutlook } from "./OutlookForecast";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";

function fixture() {
  const game = createGame({ scenarioId: 100, seed: 12345 });
  game.timeline.forEach((tick) => {
    tick.cash = 1e12;
  });
  const generator = GENERATORS(game, 50e6, [], []).find(
    (quote) => quote.name === "Natural Gas Peaker",
  )!;
  return { game, generator };
}

it("compares a full year with the actual purchased fleet without changing the live game", () => {
  const { game, generator: quote } = fixture();
  const generator = { ...quote, yearsToBuild: 0.25 };
  const original = JSON.stringify(game);
  const result = previewFacilityBuild(game, generator);
  const purchased = reducer(
    game,
    buildFacility({ facility: generator, financed: false }),
  );
  const now = game.timeline[0];
  const actual = generateForecastTimeline(
    purchased,
    now.cash,
    now.customers,
    (TICKS_PER_YEAR * TICK_MINUTES) / 60,
    60,
  );
  const grid = (ticks: typeof actual) =>
    ticks.map((tick) => [
      tick.minute,
      tick.supplyW,
      tick.demandW,
      tick.reserveW,
    ]);
  expect(result.before).toHaveLength(288);
  expect(grid(result.after)).toEqual(grid(actual));
  expect(result.before.map((tick) => tick.reserveW)).not.toEqual(
    result.after.map((tick) => tick.reserveW),
  );
  const opening = purchased.facilities.find(
    (facility) =>
      facility.id === Math.max(...purchased.facilities.map((item) => item.id)),
  )!;
  const beforeOpening = result.before.filter(
    (_, index) =>
      result.after[index].minute <
      game.date.minute + opening.yearsToBuildLeft * 12 * MINUTES_PER_MONTH,
  );
  expect(beforeOpening.length).toBeGreaterThan(0);
  expect(grid(result.after.slice(0, beforeOpening.length))).toEqual(
    grid(beforeOpening),
  );
  expect(JSON.stringify(game)).toBe(original);
});

it("does not credit projects that finish after the next year", () => {
  const { game, generator } = fixture();
  const forecast = computeOutlook("buildImpact", game, {
    ...generator,
    yearsToBuild: 2,
  })!;
  expect(forecast.before.monthlyMarginW).toHaveLength(12);
  expect(forecast.after).toEqual(forecast.before);
});

it("includes storage dispatch and keeps compact worker results identical", () => {
  const { game } = fixture();
  const storage = STORAGE(game, 100e6).find(
    (quote) => quote.name === "Battery",
  )!;
  const result = computeOutlook("buildImpact", game, storage)!;
  expect(result).toEqual(
    computeOutlook("buildImpact", forecastWorkerSnapshot(game), storage),
  );
  expect(result.before.monthlyMarginW.every(Number.isFinite)).toBe(true);
  expect(result.after.monthlyMarginW.every(Number.isFinite)).toBe(true);
  const purchased = reducer(
    game,
    buildFacility({ facility: storage, financed: false }),
  );
  expect(purchased.facilities).toHaveLength(game.facilities.length + 1);
  const now = game.timeline[0];
  const expected = generateForecastTimeline(
    purchased,
    now.cash,
    now.customers,
    (TICKS_PER_YEAR * TICK_MINUTES) / 60,
    60,
  );
  const actual = previewFacilityBuild(game, storage).after;
  expect(actual.map((tick) => tick.storageDischargeW)).toEqual(
    expected.map((tick) => tick.storageDischargeW),
  );
});
