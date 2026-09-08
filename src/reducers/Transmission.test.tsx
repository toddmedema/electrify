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
  togglePauseFacility,
} from "./Game";
import { AppStateType } from "../Types";
import { getScenario } from "../data/Scenarios";

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
  it("cannot enable transmission inside earlier tutorials", () => {
    for (const scenarioId of [0, 1, 2, 4, 3, 5]) {
      const game = createGame({ scenarioId });
      expect(game.transmission).toBeUndefined();
      expect(
        gameReducer(
          game,
          buildTransmissionLine({
            corridorId: "california-north",
            financed: true,
          }),
        ).transmission,
      ).toBeUndefined();
      expect(
        gameReducer(game, setTradingPolicy("RELIABILITY_FIRST")).transmission,
      ).toBeUndefined();
    }
  });

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

  it("rejects an ineffective trading rule until an intertie exists", () => {
    const game = createGame({ scenarioId: 100, seed: 61 });
    const next = gameReducer(game, setTradingPolicy("RELIABILITY_FIRST"));
    expect(next.transmission?.tradingPolicy).toBe("BALANCED");
    expect(next.meaningfulDecisions).toEqual([]);
  });

  it("updates and records the trading rule once it governs an intertie", () => {
    const next = gameReducer(
      buildNorthernIntertie(),
      setTradingPolicy("RELIABILITY_FIRST"),
    );
    expect(next.transmission?.tradingPolicy).toBe("RELIABILITY_FIRST");
    expect(next.meaningfulDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "trading",
          kind: "trading",
          label: "Set the regional trading rule",
        }),
      ]),
    );
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

  it("turns construction principal payments into project equity", () => {
    const state = buildNorthernIntertie();
    const line = state.transmission!.lines[0];
    line.yearsToBuildLeft = 0.5;
    state.facilities = [];
    const opening = getTimeFromTimeline(state.date.minute, state.timeline)!;
    state.timeline = generateNewTimeline(
      state,
      opening.cash,
      opening.customers,
      3,
    );
    const debtBefore = line.loanAmountLeft;

    tickState(state);

    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const principalPaid = debtBefore - line.loanAmountLeft;
    expect(line.yearsToBuildLeft).toBeGreaterThan(0);
    expect(principalPaid).toBeGreaterThan(0);
    expect(now.netWorth - now.cash).toBeCloseTo(
      180000000 - debtBefore + principalPaid,
      5,
    );
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

  it("runs Mission 7 from financed build through imports and a later safe export", () => {
    jest.useFakeTimers();
    try {
      const scenario = getScenario(112)!;
      const steps = scenario.tutorialSteps!;
      let state = createGame({ scenarioId: 112 });
      const appState = () => ({ game: state }) as AppStateType;
      expect(state.transmission).toEqual({
        tradingPolicy: "BALANCED",
        lines: [],
      });
      expect(state.facilities.map(({ fuel }) => fuel)).toEqual([
        "Sun",
        "Natural Gas",
      ]);

      const startingCash = getTimeFromTimeline(
        state.date.minute,
        state.timeline,
      )!.cash;
      state = cloneDeep(
        gameReducer(
          state,
          buildTransmissionLine({
            corridorId: "california-north",
            financed: true,
          }),
        ),
      );
      expect(getTimeFromTimeline(state.date.minute, state.timeline)!.cash).toBe(
        startingCash - 36000000,
      );
      expect(steps[1].advanceOn?.(appState())).toBe(true);

      let constructionTicks = 0;
      while (state.transmission!.lines[0].yearsToBuildLeft > 0) {
        tickState(state);
        constructionTicks++;
      }
      state.speed = "NORMAL";
      expect(constructionTicks).toBeGreaterThanOrEqual(TICKS_PER_YEAR - 1);
      expect(constructionTicks).toBeLessThanOrEqual(TICKS_PER_YEAR + 1);
      expect(steps[2].advanceOn?.(appState())).toBe(false);
      state.speed = "PAUSED";
      expect(steps[2].advanceOn?.(appState())).toBe(true);

      state = cloneDeep(
        gameReducer(state, setTradingPolicy("RELIABILITY_FIRST")),
      );
      const gas = state.facilities.find(({ fuel }) => fuel === "Natural Gas")!;
      state = cloneDeep(gameReducer(state, togglePauseFacility(gas.id)));
      expect(steps[3].advanceOn?.(appState())).toBe(true);
      expect(steps[5].advanceOn?.(appState())).toBe(true);

      const operatingTicks = [] as Array<{
        importedW: number;
        exportedW: number;
        capacityW: number;
      }>;
      while (state.date.monthsElapsed < 13) {
        tickState(state);
        const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
        operatingTicks.push({
          importedW: now.importedW || 0,
          exportedW: now.exportedW || 0,
          capacityW: now.transmissionCapacityW || 0,
        });
      }
      state.speed = "PAUSED";
      expect(steps[6].advanceOn?.(appState())).toBe(true);
      expect(
        state.monthlyHistory.some(
          (month) => (month.chartAverage?.importedW || 0) > 0,
        ),
      ).toBe(true);
      expect(state.eventLog.some(({ kind }) => kind === "BLACKOUT")).toBe(
        false,
      );

      const capstone = steps[9].capstone!;
      state = cloneDeep(gameReducer(state, setTradingPolicy("CLOSED")));
      const solar = state.facilities.find(({ fuel }) => fuel === "Sun")!;
      state = cloneDeep(gameReducer(state, togglePauseFacility(solar.id)));
      state.eventLog.push({
        id: 999,
        kind: "BLACKOUT",
        label: "Recovered",
        message: "Recovered test blackout",
        importance: "CRITICAL",
      });
      while (state.date.monthsElapsed < 14) tickState(state);
      expect(capstone.success(appState())).toBe(false);

      state = cloneDeep(gameReducer(state, setTradingPolicy("BALANCED")));
      state = cloneDeep(gameReducer(state, togglePauseFacility(solar.id)));
      while (state.date.monthsElapsed < 15) {
        tickState(state);
        const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
        operatingTicks.push({
          importedW: now.importedW || 0,
          exportedW: now.exportedW || 0,
          capacityW: now.transmissionCapacityW || 0,
        });
      }
      expect(capstone.success(appState())).toBe(true);
      expect(
        state.monthlyHistory.some(
          (month) =>
            (month.chartAverage?.exportedW || 0) > 0 &&
            (month.minimumSupplyMarginW ?? -1) >= 0,
        ),
      ).toBe(true);
      expect(
        operatingTicks.every(
          ({ importedW, exportedW, capacityW }) =>
            importedW + exportedW <= capacityW,
        ),
      ).toBe(true);
      expect(
        state.timeline.some(
          ({ transmissionCapacityW }) =>
            (transmissionCapacityW || 0) > 0 &&
            (transmissionCapacityW || 0) < 500000000,
        ),
      ).toBe(true);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
