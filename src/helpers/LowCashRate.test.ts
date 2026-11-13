import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { lowCashRateQuote } from "./LowCashRate";
import {
  forecastMonthClosingCashAtCustomerRate,
  tickState,
} from "../reducers/Game";
import { serializeSave, parseSave } from "../SaveGame";
import cloneDeep from "lodash.clonedeep";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("quotes an upward-rounded rate that covers the remaining month's costs without changing the game", () => {
  const game = createGame({ scenarioId: 100, seed: 123 });
  currentTick(game)!.cash = 90_000;
  game.dollarsPerkWh = 0.001;
  const before = JSON.stringify(game);
  const quote = lowCashRateQuote(game);
  expect(quote.projectedCash).toBeLessThan(0);
  expect(quote.dollarsPerkWh).not.toBeNull();
  const rate = quote.dollarsPerkWh!;
  expect(rate).toBeGreaterThan(game.dollarsPerkWh);
  expect(rate * 10_000).toBeCloseTo(Math.round(rate * 10_000), 8);
  expect(
    forecastMonthClosingCashAtCustomerRate(game, rate),
  ).toBeGreaterThanOrEqual(1);
  expect(
    forecastMonthClosingCashAtCustomerRate(game, rate - 0.0001),
  ).toBeLessThan(1);
  expect(JSON.stringify(game)).toBe(before);
  game.dollarsPerkWh = rate;
  while (game.date.monthsElapsed < 1) tickState(game);
  expect(currentTick(game)!.cash).toBeGreaterThanOrEqual(0);
  expect(game.monthlyHistory[0].cash).toBeGreaterThanOrEqual(0);
});

it("reports when even a public utility's capped rate cannot save it", () => {
  const game = createGame({ scenarioId: 104, seed: 123 });
  currentTick(game)!.cash = -1e12;
  expect(lowCashRateQuote(game)).toMatchObject({
    dollarsPerkWh: null,
    capped: true,
  });
});

it.each([1, 3] as const)(
  "includes the actual month-closing agreement payment in the public low-cash forecast for v%s terms",
  (termsVersion) => {
    const game = createGame({
      scenarioId: 116,
      seed: 12345,
      difficulty: "Employee",
    });
    game.transmission!.inheritedAgreementTerms = termsVersion;
    game.transmission!.lines[0].paused = true;
    game.facilities = [];
    for (let i = 0; i < 48; i++) tickState(game);
    const before = JSON.stringify(game);
    const closingCash = forecastMonthClosingCashAtCustomerRate(
      game,
      game.dollarsPerkWh,
    );
    const quote = lowCashRateQuote(game);
    expect(JSON.stringify(game)).toBe(before);
    const live = cloneDeep(game);
    while (live.date.monthsElapsed < 1) tickState(live);
    expect(closingCash).toBe(live.monthlyHistory[0].cash);
    expect(quote.projectedCash).toBe(live.monthlyHistory[0].cash);
    expect(currentTick(live)!.cash).toBe(live.monthlyHistory[0].cash);
    expect(live.transmission!.agreementAccounts).toHaveLength(2);
    for (const account of live.transmission!.agreementAccounts!) {
      expect(account.months[0].usefulMWh).toBe(0);
      expect(account.months[0].payment > 0).toBe(termsVersion === 3);
    }
  },
);

it("does not promise a rescue when there is no electricity to sell", () => {
  const game = createGame({ scenarioId: 100, seed: 123 });
  game.facilities.forEach((facility) => {
    facility.paused = true;
  });
  currentTick(game)!.cash = -1e9;
  expect(lowCashRateQuote(game).dollarsPerkWh).toBeNull();
});

it("persists the warning month and rejects untrusted future or invalid markers", () => {
  const game = createGame({ scenarioId: 100, seed: 123 });
  game.lowCashWarningMonth = 0;
  const save = serializeSave(game);
  expect(parseSave(save)?.game.lowCashWarningMonth).toBe(0);
  for (const lowCashWarningMonth of [-1, 0.5, 1, NaN, "0"]) {
    expect(
      parseSave({ ...save, game: { ...game, lowCashWarningMonth } }),
    ).toBeNull();
  }
});
