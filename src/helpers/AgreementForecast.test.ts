import * as Energy from "./Energy";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { GAME_TO_REAL_YEARS, TICK_MINUTES } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { currentTick } from "./GameSelectors";
import { powerAgreementQuote } from "./PowerAgreements";
import { computeAgreementForecast } from "./AgreementForecast";
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
  return { game, offer };
}

afterEach(() => jest.restoreAllMocks());

it.each([20, 250])(
  "reports actual closing-cash cost/benefit with spot price %s",
  (price) => {
    jest
      .spyOn(Transmission, "adjacentMarketPricePerMWh")
      .mockReturnValue(price);
    const { game, offer } = fixture();
    const offeredGame = cloneDeep(game);
    offeredGame.transmission!.acceptedAgreements = [];
    const before = JSON.stringify(offeredGame);
    const forecast = computeAgreementForecast(
      offeredGame,
      offer,
      String(price),
    );
    expect(forecast.withAgreement.servedMWh).toBeGreaterThan(
      forecast.withoutAgreement.servedMWh,
    );
    const noSpot = cloneDeep(offeredGame);
    noSpot.transmission!.buyingRule = "NONE";
    expect(computeAgreementForecast(noSpot, offer, String(price))).toEqual(
      forecast,
    );
    expect(JSON.stringify(offeredGame)).toBe(before);
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
  const { game, offer } = fixture(239);
  game.transmission!.acceptedAgreements = [];
  const result = computeAgreementForecast(game, offer, "full-horizon");
  expect(result.endMinute).toBe(300 * MINUTES_PER_MONTH);
  const closed = cloneDeep(game);
  closed.multiplayer = { seat: "0" };
  expect(() => computeAgreementForecast(closed, offer)).toThrow(
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
  const { game, offer } = fixture();
  game.transmission!.acceptedAgreements = [];
  const result = computeAgreementForecast(game, offer, "constrained-access");
  expect(result.cashDifference).toBeLessThan(0);
  expect(
    result.withAgreement.servedMWh / result.withAgreement.demandMWh,
  ).toBeGreaterThan(
    result.withoutAgreement.servedMWh / result.withoutAgreement.demandMWh,
  );
});

it("reports equal service when owned generation covers demand without the agreement", () => {
  const { game, offer } = fixture();
  game.transmission!.acceptedAgreements = [];
  currentTick(game)!.customers = 10000;
  const native = createGame({ scenarioId: 116, seed: 12345 }).facilities.filter(
    (facility) => facility.fuel === "Natural Gas",
  );
  native.forEach((facility) => {
    facility.peakW = 300e6;
    facility.currentW = 300e6;
    facility.spinMinutes = 1;
    facility.lifespanYears = 100;
  });
  game.facilities = native;
  const result = computeAgreementForecast(game, offer, "ample-market");
  expect(
    result.withAgreement.servedMWh / result.withAgreement.demandMWh,
  ).toBeCloseTo(1, 10);
  expect(
    result.withoutAgreement.servedMWh / result.withoutAgreement.demandMWh,
  ).toBeCloseTo(1, 10);
});

it("carries actual v3 monthly usage into private forecast settlement and closing cash", () => {
  jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
  const game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  jest.spyOn(Energy, "getWindOutputFactor").mockReturnValue(1);
  game.facilities = game.facilities.filter(
    (facility) => facility.fuel === "Wind",
  );
  game.facilities.forEach((facility) => {
    facility.peakW = 1e9;
  });
  for (let i = 0; i < 48; i++) tickState(game);
  const before = JSON.stringify(game.transmission!.agreementAccounts);
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
});

it("allows a v3 forecast loss from unused monthly energy despite its below-market rate", () => {
  jest.spyOn(Transmission, "adjacentMarketPricePerMWh").mockReturnValue(20);
  const { game } = fixture();
  game.date = getDateFromMinute(156 * MINUTES_PER_MONTH, 2005);
  game.transmission!.acceptedAgreements = [];
  const offer = powerAgreementQuote(game, "champlain-quebec", 3, 10)!.receipt;
  game.date = getDateFromMinute(299 * MINUTES_PER_MONTH, 2005);
  currentTick(game)!.customers = 100;
  jest.spyOn(Energy, "getWindOutputFactor").mockReturnValue(1);
  game.facilities = createGame({
    scenarioId: 116,
    seed: 12345,
  }).facilities.filter((facility) => facility.fuel === "Wind");
  game.facilities.forEach((facility) => {
    facility.peakW = 1e9;
    facility.minuteCreated = game.date.minute;
    facility.minuteOperational = game.date.minute;
    facility.lifespanYears = 100;
  });
  const result = computeAgreementForecast(game, offer, "monthly-underuse");
  expect(result.cashDifference).toBeLessThan(0);
});

it("uses each offered signing ceiling in the real-reducer forecast and its cache", () => {
  const spot = jest.spyOn(Transmission, "adjacentMarketPricePerMWh");
  const { game } = fixture();
  game.transmission!.acceptedAgreements = [];
  game.date = getDateFromMinute(156 * MINUTES_PER_MONTH, 2005);
  spot.mockReturnValue(20);
  const lower = powerAgreementQuote(game, "champlain-quebec", 3, 10)!;
  spot.mockReturnValue(250);
  const higher = powerAgreementQuote(game, "champlain-quebec", 3, 10)!;
  game.date = getDateFromMinute(299 * MINUTES_PER_MONTH, 2005);
  spot.mockReturnValue(500);
  const lowerForecast = computeAgreementForecast(
    game,
    lower.receipt,
    "signing-ceilings",
  );
  const higherForecast = computeAgreementForecast(
    game,
    higher.receipt,
    "signing-ceilings",
  );
  expect(lowerForecast.cashDifference).toBeGreaterThan(
    higherForecast.cashDifference,
  );
  expect(lowerForecast.withAgreement).toEqual(higherForecast.withAgreement);
});
