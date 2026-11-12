import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { GAME_TO_REAL_YEARS, TICK_MINUTES } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { currentTick } from "./GameSelectors";
import { powerAgreementQuote } from "./PowerAgreements";
import {
  agreementForecastKey,
  computeAgreementForecast,
} from "./AgreementForecast";
import { generateForecastTimeline, tickState } from "../reducers/Game";
import * as Transmission from "./Transmission";
import * as Access from "../data/IntertieAccess";

function fixture(month = 299) {
  const game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  game.transmission!.inheritedAgreementTerms = 2;
  game.facilities = [];
  game.date = getDateFromMinute(156 * MINUTES_PER_MONTH, 2005);
  const offer = powerAgreementQuote(game, "champlain-quebec", 2)!.receipt;
  game.transmission!.acceptedAgreements = [offer];
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, 2005);
  for (const tick of game.timeline) tick.minute += game.date.minute;
  return game;
}

afterEach(() => jest.restoreAllMocks());

it.each([
  [20, -1],
  [250, 1],
])(
  "reports actual closing-cash cost/benefit with spot price %s",
  (price, direction) => {
    jest
      .spyOn(Transmission, "adjacentMarketPricePerMWh")
      .mockReturnValue(price);
    const game = fixture();
    const before = JSON.stringify(game);
    const forecast = computeAgreementForecast(
      game,
      "champlain-quebec:0",
      undefined,
      String(price),
    );
    expect(Math.sign(forecast.cashDifference)).toBe(direction);
    expect(JSON.stringify(game)).toBe(before);
    const now = currentTick(game)!;
    const ticks = (forecast.endMinute - game.date.minute) / TICK_MINUTES + 1;
    const withAgreement = generateForecastTimeline(
      game,
      now.cash,
      now.customers,
      ticks,
    );
    const market = generateForecastTimeline(
      game,
      now.cash,
      now.customers,
      ticks,
      TICK_MINUTES,
      undefined,
      "champlain-quebec:0",
    );
    expect(forecast.cashDifference).toBe(
      withAgreement.at(-1)!.cash - market.at(-1)!.cash,
    );
    const demand = withAgreement
      .slice(1)
      .reduce(
        (sum, tick) => sum + ((tick.demandW / 4) * GAME_TO_REAL_YEARS) / 1e6,
        0,
      );
    expect(forecast.withAgreement.demandMWh).toBeCloseTo(demand, 6);
  },
);

it("reaches the full exclusive delivery end beyond the mission and keeps unavailable comparisons explicit", () => {
  const game = fixture(239);
  const result = computeAgreementForecast(
    game,
    "champlain-quebec:0",
    undefined,
    "full-horizon",
  );
  expect(result.endMinute).toBe(300 * MINUTES_PER_MONTH);
  expect(result.remaining.availableMWh).toBeGreaterThan(
    57 * 24 * GAME_TO_REAL_YEARS * 60 * 0.5,
  );
  const closed = cloneDeep(game);
  closed.transmission!.buyingRule = "NONE";
  expect(() => computeAgreementForecast(closed, "champlain-quebec:0")).toThrow(
    "Comparison unavailable",
  );
});

it("can cost more while serving a larger share with constrained merchant access, without adding supplier energy", () => {
  const original = Access.effectiveMarket;
  jest.spyOn(Access, "effectiveMarket").mockImplementation((...args) => {
    const market = original(...args);
    return market && { ...market, availableSupplyW: 20e6 };
  });
  jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
  const result = computeAgreementForecast(
    fixture(),
    "champlain-quebec:0",
    undefined,
    "constrained-access",
  );
  expect(result.cashDifference).toBeLessThan(0);
  expect(
    result.withAgreement.servedMWh / result.withAgreement.demandMWh,
  ).toBeGreaterThan(
    result.marketPurchases.servedMWh / result.marketPurchases.demandMWh,
  );
  expect(result.remaining.availableMWh).toBeLessThanOrEqual(
    20 * 24 * GAME_TO_REAL_YEARS + 1e-5,
  );
});

it("reports equal service when the existing market can serve the same demand", () => {
  const game = fixture();
  currentTick(game)!.customers = 10000;
  const result = computeAgreementForecast(
    game,
    "champlain-quebec:0",
    undefined,
    "ample-market",
  );
  expect(
    result.withAgreement.servedMWh / result.withAgreement.demandMWh,
  ).toBeCloseTo(1, 10);
  expect(
    result.marketPurchases.servedMWh / result.marketPurchases.demandMWh,
  ).toBeCloseTo(1, 10);
});

it("freezes recorded-plus-remaining totals at its accounting cutoff instead of overlapping newer actuals", () => {
  const game = fixture();
  tickState(game);
  const first = computeAgreementForecast(
    game,
    "champlain-quebec:0",
    undefined,
    "frozen-cutoff",
  );
  const recorded = first.recorded.availableMWh;
  tickState(game);
  const cached = computeAgreementForecast(
    game,
    "champlain-quebec:0",
    undefined,
    "frozen-cutoff",
  );
  expect(cached).toBe(first);
  expect(cached.cutoffMinute).toBe(299 * MINUTES_PER_MONTH + TICK_MINUTES);
  expect(cached.recorded.availableMWh).toBe(recorded);
  expect(
    game.transmission!.agreementAccounts![0].months[0].availableMWh,
  ).toBeGreaterThan(recorded);
});

it("carries actual v3 monthly usage into private forecast settlement and closing cash", () => {
  jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
  const game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  game.facilities = [];
  game.transmission!.lines[0].paused = true;
  for (let i = 0; i < 48; i++) tickState(game);
  const before = JSON.stringify(game.transmission!.agreementAccounts);
  const key = agreementForecastKey(game, "champlain-nuclear");
  let finalAccounts: NonNullable<typeof game.transmission>["agreementAccounts"];
  const now = currentTick(game)!;
  const forecast = generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    49,
    TICK_MINUTES,
    (privateGame, frame) => {
      if (frame.minute === MINUTES_PER_MONTH)
        finalAccounts = cloneDeep(privateGame.transmission!.agreementAccounts);
    },
  );
  expect(JSON.stringify(game.transmission!.agreementAccounts)).toBe(before);
  const closing = forecast.at(-1)!;
  expect(closing.minute).toBe(MINUTES_PER_MONTH);
  const expectedTopUp = finalAccounts!.reduce(
    (sum, account) => sum + account.months[0].availableValue! * 0.7,
    0,
  );
  expect(closing.agreementUnusedExpenses).toBeCloseTo(expectedTopUp, 6);
  // Replay the very same real-reducer weather/demand frames, so only accounting ownership differs.
  game.timeline = forecast;
  for (let i = 0; i < 48; i++) tickState(game);
  expect(game.transmission!.agreementAccounts).toEqual(finalAccounts!);
  expect(currentTick(game)!.cash).toBeCloseTo(closing.cash, 6);
  expect(agreementForecastKey(game, "champlain-nuclear")).not.toBe(key);
});

it("allows a v3 forecast loss from unused monthly energy despite its below-market rate", () => {
  jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
  const game = fixture();
  game.date = getDateFromMinute(156 * MINUTES_PER_MONTH, 2005);
  game.transmission!.acceptedAgreements = [];
  game.transmission!.acceptedAgreements = [
    powerAgreementQuote(game, "champlain-quebec", 3, 10)!.receipt,
  ];
  game.date = getDateFromMinute(299 * MINUTES_PER_MONTH, 2005);
  currentTick(game)!.customers = 100;
  const result = computeAgreementForecast(
    game,
    "champlain-quebec:0",
    undefined,
    "monthly-underuse",
  );
  expect(result.cashDifference).toBeLessThan(0);
  expect(result.remaining.unusedPayment).toBeGreaterThan(0);
  expect(result.remaining.payment).toBeGreaterThan(
    result.remaining.unusedPayment,
  );
});
