import cloneDeep from "lodash.clonedeep";
import { publicTargetRate } from "../helpers/Customers";
import { getScenario } from "../data/Scenarios";
import { getRateInflationIndex } from "../data/Economy";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { GameType } from "../Types";
import gameReducer, {
  delta,
  forecastMonthClosingCashAtCustomerRate,
  generateNewTimeline,
} from "./Game";
import { getDateFromMinute } from "../helpers/DateTime";
import { projectionSignature } from "../helpers/Projection";

// Hurricane Season is a public utility; Investor Owned Utility is not.
const PUBLIC_ID = 104;
const INVESTOR_ID = 100;

function target(game: GameType) {
  return publicTargetRate(
    getScenario(PUBLIC_ID)!.dollarsPerkWh,
    game.date,
    game.startingYear,
    game.seed,
  );
}

function indexAt(game: GameType, minute: number) {
  return getRateInflationIndex(
    getDateFromMinute(minute, game.startingYear),
    game.startingYear,
    game.seed,
  );
}

describe("utility rate following inflation", () => {
  it.each([false, true])(
    "forecasts the rate's January inflation step without changing the live rate (customer flexibility: %s)",
    (flexibility) => {
      const game = createGame({
        scenarioId: PUBLIC_ID,
        initialPrograms: flexibility ? { thermal: "On" } : undefined,
      });
      // A hand-set rate that following then resumes from: the forecast must carry it forward
      // with inflation, not lock it to the scenario's target.
      const resumed = gameReducer(
        gameReducer(game, delta({ dollarsPerkWh: 0.12 })),
        delta({ rateFollowsInflation: true }),
      );
      const fixed = { ...resumed, rateFollowsInflation: false };
      const now = resumed.timeline[0];
      const forecast = (state: GameType) =>
        generateNewTimeline(state, now.cash, now.customers, 13 * 24, 60);
      const following = forecast(resumed);
      const manual = forecast(fixed);
      expect(following.some((tick) => (tick.thermalShiftedW ?? 0) > 0)).toBe(
        flexibility,
      );
      expect(following.slice(0, 24)).toEqual(manual.slice(0, 24));
      const nextYear = following[12 * 24];
      expect(nextYear.customerBillingRate).toBe(
        0.12 * indexAt(resumed, nextYear.minute),
      );
      expect(nextYear.customerBillingRate).not.toBe(
        target({
          ...resumed,
          date: getDateFromMinute(nextYear.minute, resumed.startingYear),
        }),
      );
      expect(nextYear.customerBillingRate).not.toBe(
        manual[12 * 24].customerBillingRate,
      );
      expect(nextYear.cash).not.toBe(manual[12 * 24].cash);
      expect(resumed.dollarsPerkWh).toBe(0.12);
    },
  );

  it("invalidates the forecast when following changes at the same price", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const fixed = gameReducer(game, delta({ rateFollowsInflation: false }));
    expect(fixed.dollarsPerkWh).toBe(game.dollarsPerkWh);
    expect(projectionSignature(fixed)).not.toBe(projectionSignature(game));
  });

  it("probes a manual rate without following inflation or editing the live game", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const fixed = { ...game, rateFollowsInflation: false };
    const cash = forecastMonthClosingCashAtCustomerRate(game, 0.04);
    expect(cash).toBe(forecastMonthClosingCashAtCustomerRate(fixed, 0.04));
    expect(cash).toBeLessThan(
      forecastMonthClosingCashAtCustomerRate(game, 0.12),
    );
    expect(game.rateFollowsInflation).toBe(true);
    expect(game.dollarsPerkWh).toBe(getScenario(PUBLIC_ID)!.dollarsPerkWh);
  });

  it("starts new public games following inflation and leaves investor rates alone", () => {
    expect(createGame({ scenarioId: PUBLIC_ID }).rateFollowsInflation).toBe(
      true,
    );
    expect(createGame({ scenarioId: INVESTOR_ID }).rateFollowsInflation).toBe(
      false,
    );
  });

  it("adjusts the rate with inflation across a new year until a rate is set by hand", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const startYear = game.date.year;
    runMonths(game, 13);
    expect(game.date.year).toBe(startYear + 1);
    const index = getRateInflationIndex(
      game.date,
      game.startingYear,
      game.seed,
    );
    expect(index).not.toBe(1);
    // The rate moved by the year's inflation from its starting level...
    expect(game.dollarsPerkWh).toBe(
      getScenario(PUBLIC_ID)!.dollarsPerkWh * index,
    );
    // ...which is still the target, since the player never set a rate by hand.
    expect(game.dollarsPerkWh).toBe(target(game));

    const manual = cloneDeep(gameReducer(game, delta({ dollarsPerkWh: 0.12 })));
    expect(manual.rateFollowsInflation).toBe(false);
    runMonths(manual, 12);
    expect(manual.dollarsPerkWh).toBe(0.12);
  });

  it.each([PUBLIC_ID, INVESTOR_ID])(
    "keeps the current rate when following resumes, then adjusts it with inflation (scenario %s)",
    (scenarioId) => {
      const manual = gameReducer(
        createGame({ scenarioId }),
        delta({ dollarsPerkWh: 0.12 }),
      );
      const resumed = gameReducer(
        manual,
        delta({ rateFollowsInflation: true }),
      );
      expect(resumed.rateFollowsInflation).toBe(true);
      // No snap to the target: 12 cents stays in force.
      expect(resumed.dollarsPerkWh).toBe(0.12);
      // The January step then carries the hand-set rate forward with inflation.
      const live = cloneDeep(resumed);
      runMonths(live, 13);
      const index = getRateInflationIndex(
        live.date,
        live.startingYear,
        live.seed,
      );
      expect(index).not.toBe(1);
      expect(live.dollarsPerkWh).toBe(0.12 * index);
    },
  );

  it("lets an investor opt in without changing the current rate", () => {
    const game = createGame({ scenarioId: INVESTOR_ID });
    const next = gameReducer(game, delta({ rateFollowsInflation: true }));
    expect(next.rateFollowsInflation).toBe(true);
    expect(next.dollarsPerkWh).toBe(game.dollarsPerkWh);
    const now = next.timeline[0];
    const forecast = generateNewTimeline(
      next,
      now.cash,
      now.customers,
      13 * 24,
      60,
    );
    expect(forecast[12 * 24].customerBillingRate).toBe(
      game.dollarsPerkWh * indexAt(game, forecast[12 * 24].minute),
    );
    const manual = gameReducer(next, delta({ dollarsPerkWh: 0.12 }));
    expect(manual.rateFollowsInflation).toBe(false);
  });

  it.each(["tutorial", "multiplayer"])(
    "rejects enabling inflation following in %s",
    (kind) => {
      const game = createGame({
        scenarioId: kind === "tutorial" ? 0 : INVESTOR_ID,
      });
      if (kind === "multiplayer") game.multiplayer = { seat: "host" };
      const next = gameReducer(game, delta({ rateFollowsInflation: true }));
      expect(next.rateFollowsInflation).toBe(false);
      expect(next.dollarsPerkWh).toBe(game.dollarsPerkWh);
    },
  );

  it("ignores a saved follow setting on a run that cannot follow inflation", () => {
    // parseSave accepts the boolean on any run, so an edited save can carry it.
    const game = {
      ...createGame({ scenarioId: 0 }),
      rateFollowsInflation: true,
    };
    const rate = game.dollarsPerkWh;
    const now = game.timeline[0];
    const forecast = generateNewTimeline(
      game,
      now.cash,
      now.customers,
      13 * 24,
      60,
    );
    expect(forecast[12 * 24].customerBillingRate).toBe(rate);
    runMonths(game, 13);
    expect(
      getRateInflationIndex(game.date, game.startingYear, game.seed),
    ).not.toBe(1);
    expect(game.dollarsPerkWh).toBe(rate);
  });
});
