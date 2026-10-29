import cloneDeep from "lodash.clonedeep";
import { publicTargetRate } from "../helpers/Customers";
import { getScenario } from "../data/Scenarios";
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

describe("public utility rate following its target", () => {
  it.each([false, true])(
    "forecasts future target changes without changing the live rate (customer flexibility: %s)",
    (flexibility) => {
      const game = createGame({
        scenarioId: PUBLIC_ID,
        initialPrograms: flexibility ? { thermal: "On" } : undefined,
      });
      const fixed = { ...game, rateFollowsTarget: false };
      const now = game.timeline[0];
      const forecast = (state: GameType) =>
        generateNewTimeline(state, now.cash, now.customers, 13 * 24, 60);
      const following = forecast(game);
      const manual = forecast(fixed);
      expect(following.some((tick) => (tick.thermalShiftedW ?? 0) > 0)).toBe(
        flexibility,
      );
      expect(following.slice(0, 24)).toEqual(manual.slice(0, 24));
      const nextYear = following[12 * 24];
      expect(nextYear.customerBillingRate).toBe(
        target({
          ...game,
          date: getDateFromMinute(nextYear.minute, game.startingYear),
        }),
      );
      expect(nextYear.customerBillingRate).not.toBe(
        manual[12 * 24].customerBillingRate,
      );
      expect(nextYear.cash).not.toBe(manual[12 * 24].cash);
      expect(game.dollarsPerkWh).toBe(target(game));
    },
  );

  it("invalidates the forecast when following changes at the same price", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const fixed = gameReducer(game, delta({ rateFollowsTarget: false }));
    expect(fixed.dollarsPerkWh).toBe(game.dollarsPerkWh);
    expect(projectionSignature(fixed)).not.toBe(projectionSignature(game));
  });

  it("probes a manual rate without following the target or editing the live game", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const fixed = { ...game, rateFollowsTarget: false };
    const cash = forecastMonthClosingCashAtCustomerRate(game, 0.04);
    expect(cash).toBe(forecastMonthClosingCashAtCustomerRate(fixed, 0.04));
    expect(cash).toBeLessThan(
      forecastMonthClosingCashAtCustomerRate(game, 0.12),
    );
    expect(game.rateFollowsTarget).toBe(true);
    expect(game.dollarsPerkWh).toBe(target(game));
  });

  it("starts new public games following and leaves investor rates alone", () => {
    expect(createGame({ scenarioId: PUBLIC_ID }).rateFollowsTarget).toBe(true);
    expect(createGame({ scenarioId: INVESTOR_ID }).rateFollowsTarget).toBe(
      false,
    );
  });

  it("tracks the inflating target across a new year until a rate is set by hand", () => {
    const game = createGame({ scenarioId: PUBLIC_ID });
    const startYear = game.date.year;
    const startTarget = target(game);
    runMonths(game, 13);
    expect(game.date.year).toBe(startYear + 1);
    expect(target(game)).not.toBe(startTarget);
    expect(game.dollarsPerkWh).toBe(target(game));

    const manual = cloneDeep(gameReducer(game, delta({ dollarsPerkWh: 0.08 })));
    expect(manual.rateFollowsTarget).toBe(false);
    runMonths(manual, 12);
    expect(manual.dollarsPerkWh).toBe(0.08);
  });

  it("snaps to the target when following is turned back on", () => {
    const manual = gameReducer(
      createGame({ scenarioId: PUBLIC_ID }),
      delta({ dollarsPerkWh: 0.08 }),
    );
    const resumed = gameReducer(manual, delta({ rateFollowsTarget: true }));
    expect(resumed.rateFollowsTarget).toBe(true);
    expect(resumed.dollarsPerkWh).toBe(target(resumed));
  });

  it("cannot follow a target that an investor-owned utility doesn't have", () => {
    const game = createGame({ scenarioId: INVESTOR_ID });
    const next = gameReducer(game, delta({ rateFollowsTarget: true }));
    expect(next.rateFollowsTarget).toBe(false);
    expect(next.dollarsPerkWh).toBe(game.dollarsPerkWh);
  });
});
