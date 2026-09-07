import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_YEAR, YEARS_PER_TICK } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { serializeReplay } from "../Replay";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import gameReducer, {
  buildTransmissionLine,
  generateNewTimeline,
  setTradingPolicy,
  tickState,
} from "./Game";

function buildNorthernIntertie() {
  const game = createGame({ scenarioId: 100, seed: 61 });
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 1000000000;
  return cloneDeep(
    gameReducer(
      game,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    ),
  );
}

describe("transmission actions", () => {
  it("builds one valid California corridor and charges the down payment", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    const before = getTimeFromTimeline(game.date.minute, game.timeline)!.cash;
    getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 1000000000;
    const next = gameReducer(
      game,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    );
    expect(next.transmission?.lines).toHaveLength(1);
    expect(next.transmission?.lines[0]).toMatchObject({
      corridorId: "california-north",
      yearsToBuildLeft: 1,
      financed: true,
    });
    expect(getTimeFromTimeline(next.date.minute, next.timeline)!.cash).toBe(
      1000000000 - 180000000 * 0.2,
    );
    const duplicate = gameReducer(
      next,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    );
    expect(duplicate.transmission?.lines).toHaveLength(1);
    expect(Number.isFinite(before)).toBe(true);
  });

  it("updates the trading rule", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    const next = gameReducer(game, setTradingPolicy("RELIABILITY_FIRST"));
    expect(next.transmission?.tradingPolicy).toBe("RELIABILITY_FIRST");
  });

  it("keeps construction equity neutral instead of counting the intertie loan twice", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    now.cash = 1000000000;
    const netWorthBefore = generateNewTimeline(
      game,
      now.cash,
      now.customers,
      1,
    )[0].netWorth;

    const next = gameReducer(
      game,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    );
    const after = getTimeFromTimeline(next.date.minute, next.timeline)!;

    expect(after.netWorth).toBe(netWorthBefore);
  });

  it("commissions an intertie, imports a shortage, and books its full cash costs", () => {
    const state = buildNorthernIntertie();
    const line = state.transmission!.lines[0];
    line.yearsToBuildLeft = YEARS_PER_TICK;
    state.facilities = [];
    const opening = getTimeFromTimeline(state.date.minute, state.timeline)!;
    state.timeline = generateNewTimeline(
      state,
      opening.cash,
      opening.customers,
      3,
    );
    const cashBefore = state.timeline[0].cash;
    const debtBefore = line.loanAmountLeft;

    tickState(state);

    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const principalPaid = debtBefore - line.loanAmountLeft;
    expect(line.yearsToBuildLeft).toBe(0);
    expect(now.importedW).toBeGreaterThan(0);
    expect(now.exportedW).toBe(0);
    expect(now.supplyW).toBe(now.demandW);
    expect(now.expensesImports).toBeGreaterThan(0);
    expect(now.expensesOM).toBeCloseTo(3600000 / TICKS_PER_YEAR, 5);
    expect(now.expensesInterest).toBeGreaterThan(0);
    expect(line.loanAmountLeft).toBeLessThan(debtBefore);
    expect(now.cash).toBe(
      Math.round(
        cashBefore +
          now.revenue -
          now.expensesImports! -
          now.expensesOM -
          now.expensesInterest -
          principalPaid,
      ),
    );
    expect(
      state.eventLog.some(({ message }) => message.includes("Intertie open")),
    ).toBe(true);
  });

  it("does not mutate live intertie construction or debt while forecasting", () => {
    const state = buildNorthernIntertie();
    const before = cloneDeep(state.transmission);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;

    generateNewTimeline(state, now.cash, now.customers, 8);

    expect(state.transmission).toEqual(before);
  });

  it("replays intertie builds and trading policy changes", () => {
    let game = createGame({ scenarioId: 100, seed: 61 });
    game = gameReducer(
      game,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: true,
      }),
    );
    game = gameReducer(game, setTradingPolicy("RELIABILITY_FIRST"));

    const replayed = createGameFromReplay(serializeReplay(game)!);

    expect(replayed.transmission).toMatchObject({
      tradingPolicy: "RELIABILITY_FIRST",
      lines: [
        expect.objectContaining({
          corridorId: "california-north",
          financed: true,
        }),
      ],
    });
  });
});
