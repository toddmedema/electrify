import cloneDeep from "lodash.clonedeep";
import {
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
  TICKS_PER_HOUR,
  GAME_TO_REAL_YEARS,
  DIFFICULTIES,
} from "../Constants";
import {
  getTimeFromTimeline,
  summarizeTimeline,
  summarizeHistory,
} from "../helpers/DateTime";
import { serializeReplay } from "../Replay";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import gameReducer, {
  buildTransmissionLine,
  generateNewTimeline,
  setTradingPolicy,
  tickState,
  togglePauseFacility,
} from "./Game";
import {
  AppStateType,
  DifficultyType,
  GameType,
  TickPresentFutureType,
} from "../Types";
import { getScenario } from "../data/Scenarios";
import {
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "../data/AdjacentMarkets";
import { IntertieArchetypeIdType } from "../data/IntertieArchetypes";
import {
  adjacentMarketPricePerMWh,
  importAvailabilityFraction,
  intertieContextForGame,
  transmissionRatingW,
} from "../helpers/Transmission";

function buildNorthernIntertie(difficulty?: DifficultyType) {
  const game = createGame({ scenarioId: 100, seed: 61, difficulty });
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

/** Representative-day watts on one live tick, as the megawatt-hours the month is billed for */
function tickMWh(w: number): number {
  return ((w / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS) / 1000000;
}

/** What each operating line could offer on this tick, from the same helpers the reducer uses */
function lineOffers(state: GameType, now: TickPresentFutureType) {
  const context = intertieContextForGame(state);
  return state
    .transmission!.lines.filter(({ yearsToBuildLeft }) => yearsToBuildLeft <= 0)
    .map((line) => {
      const market = adjacentMarketForCorridor(line.corridorId)!;
      const ratingW = transmissionRatingW(line, now);
      return {
        corridorId: line.corridorId,
        ratingW,
        pricePerMWh: adjacentMarketPricePerMWh(
          line.corridorId,
          context,
          now.minute,
          now,
        ),
        importLimitW: Math.min(
          ratingW *
            importAvailabilityFraction(
              line.corridorId,
              context,
              now.minute,
              now,
            ),
          market.availableSupplyW,
        ),
        emissionsKgco2ePerMWh: market.emissionsKgco2ePerMWh,
      };
    });
}

function corridorFor(archetype: IntertieArchetypeIdType): string {
  const corridor = TRANSMISSION_CORRIDORS.find(
    ({ id }) => adjacentMarketForCorridor(id)?.archetype === archetype,
  );
  if (!corridor) {
    throw new Error(`No intertie corridor reaches a ${archetype} neighbour`);
  }
  return corridor.id;
}

/** Two operating California lines and no local plants, in mild, dark weather */
function twoIntertiesWithoutPlants() {
  const state = buildNorthernIntertie();
  state.facilities = [];
  const north = state.transmission!.lines[0];
  north.yearsToBuildLeft = 0;
  state.transmission!.lines.push({
    ...north,
    id: 2,
    corridorId: "california-south",
  });
  state.timeline.forEach((t) => {
    t.temperatureC = 20;
    t.solarIrradianceWM2 = 0;
  });
  return state;
}

/** The tick the next `tickState` will settle, found on a throwaway copy */
function nextTick(state: GameType) {
  const probe = cloneDeep(state);
  tickState(probe);
  return {
    probe,
    now: getTimeFromTimeline(probe.date.minute, probe.timeline)!,
  };
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
    // With no local plants the whole demand is short; the neighbour fills what it can spare.
    const [offer] = lineOffers(state, now);
    const expectedImportW = Math.min(
      now.demandW,
      offer.ratingW,
      offer.importLimitW,
    );
    expect(now.importedW).toBeGreaterThan(0);
    expect(now.importedW).toBeCloseTo(expectedImportW, 0);
    expect(now.exportedW).toBe(0);
    expect(now.supplyW).toBeCloseTo(expectedImportW, 0);
    expect(now.transmissionCapacityW).toBe(offer.ratingW);
    expect(now.marketPricePerMWh).toBeCloseTo(offer.pricePerMWh, 6);
    expect(now.expensesImports).toBeCloseTo(
      tickMWh(now.importedW!) * offer.pricePerMWh,
      6,
    );
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
      expect(
        steps
          .find((step) => step.action === "Tap Take loan")!
          .advanceOn?.(appState()),
      ).toBe(true);

      let constructionTicks = 0;
      while (state.transmission!.lines[0].yearsToBuildLeft > 0) {
        tickState(state);
        constructionTicks++;
      }
      state.speed = "NORMAL";
      expect(constructionTicks).toBeGreaterThanOrEqual(TICKS_PER_YEAR - 1);
      expect(constructionTicks).toBeLessThanOrEqual(TICKS_PER_YEAR + 1);
      expect(
        steps
          .find(
            (step) =>
              step.action === "Pause when the line shows a power reading",
          )!
          .advanceOn?.(appState()),
      ).toBe(false);
      state.speed = "PAUSED";
      expect(
        steps
          .find(
            (step) =>
              step.action === "Pause when the line shows a power reading",
          )!
          .advanceOn?.(appState()),
      ).toBe(true);

      state = cloneDeep(
        gameReducer(state, setTradingPolicy("RELIABILITY_FIRST")),
      );
      const gas = state.facilities.find(({ fuel }) => fuel === "Natural Gas")!;
      state = cloneDeep(gameReducer(state, togglePauseFacility(gas.id)));
      expect(
        steps
          .find((step) => step.action === "Choose “Buy for shortages only”")!
          .advanceOn?.(appState()),
      ).toBe(true);
      expect(
        steps
          .find((step) => step.action === "Tap Pause on the gas plant")!
          .advanceOn?.(appState()),
      ).toBe(true);

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
      expect(
        steps
          .find((step) => step.action === "Pause after an importing month")!
          .advanceOn?.(appState()),
      ).toBe(true);
      expect(
        state.monthlyHistory.some(
          (month) => (month.chartAverage?.importedW || 0) > 0,
        ),
      ).toBe(true);
      expect(state.eventLog.some(({ kind }) => kind === "BLACKOUT")).toBe(
        false,
      );

      const capstone = steps.find((step) => step.capstone)!.capstone!;
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
        expect(now.availableSupplyW).toBeGreaterThanOrEqual(
          now.supplyW + (now.exportedW || 0),
        );
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
  it("records purchased emissions separately and charges local carbon only once", () => {
    const state = buildNorthernIntertie();
    state.facilities = [];
    state.transmission!.lines[0].yearsToBuildLeft = 0;
    state.timeline.forEach((t) => {
      t.demandW = 100000000;
    });
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const intensity =
      adjacentMarketForCorridor("california-north")!.emissionsKgco2ePerMWh;
    expect(now.importedW).toBe(100000000);
    expect(now.localKgco2e).toBe(0);
    expect(now.importedKgco2e).toBeCloseTo(
      (((100000000 / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS) / 1000000) *
        intensity,
    );
    expect(now.kgco2e).toBe(now.importedKgco2e);
    expect(now.expensesCarbonFee).toBe(0);
    expect(now.expensesImports).toBeGreaterThan(0);
    const month = summarizeTimeline([now], state.startingYear);
    expect(month.importedKgco2e).toBe(now.importedKgco2e);
    expect(month.localKgco2e).toBe(0);
    expect(summarizeHistory([month]).importedKgco2e).toBe(now.importedKgco2e);
  });
  it("weights purchased emissions by the imports each line actually carries", () => {
    const state = twoIntertiesWithoutPlants();
    state.transmission!.lines[0].capacityW = 100000000;
    state.transmission!.lines[1].capacityW = 300000000;
    state.timeline.forEach((t) => {
      t.demandW = 200000000;
    });
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const offers = lineOffers(state, now);
    // Merit order: fill the cheaper neighbour first, then the other with what remains
    const [cheap, dear] = [...offers].sort(
      (a, b) => a.pricePerMWh - b.pricePerMWh,
    );
    const importedW = Math.min(
      200000000,
      cheap.importLimitW + dear.importLimitW,
    );
    const cheapW = Math.min(importedW, cheap.importLimitW);
    const dearW = importedW - cheapW;
    const intensity =
      (cheapW * cheap.emissionsKgco2ePerMWh +
        dearW * dear.emissionsKgco2ePerMWh) /
      importedW;
    expect(now.importedW).toBeCloseTo(importedW, 0);
    expect(now.importKgco2ePerMWh).toBeCloseTo(intensity, 6);
    expect(now.kgco2e).toBeCloseTo(tickMWh(importedW) * intensity, 3);
  });

  it("records each line's own signed flow, not just the fleet total", () => {
    const state = twoIntertiesWithoutPlants();
    // Too little room on the cheaper line for the whole shortfall, so both must carry some
    state.transmission!.lines[0].capacityW = 100000000;
    state.transmission!.lines[1].capacityW = 300000000;
    state.timeline.forEach((t) => {
      t.demandW = 200000000;
    });
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const lines = state.transmission!.lines;
    expect(now.importedW).toBeGreaterThan(0);
    // Buying reads positive, and the parts add up to the total the tick reported
    lines.forEach((line) => expect(line.currentFlowW).toBeGreaterThan(0));
    expect(
      lines.reduce((sum, line) => sum + (line.currentFlowW || 0), 0),
    ).toBeCloseTo(now.importedW! - (now.exportedW || 0), 0);
    lines.forEach((line) =>
      expect(Math.abs(line.currentFlowW!)).toBeLessThanOrEqual(
        transmissionRatingW(line, now) + 1,
      ),
    );
  });

  it("signs a line that is selling power the other way", () => {
    const state = twoIntertiesWithoutPlants();
    // A large must-run fleet against tiny demand leaves surplus with nowhere to go but out
    const source = createGame({ scenarioId: 100, seed: 61 });
    state.facilities = cloneDeep(source.facilities).map((facility) => ({
      ...facility,
      yearsToBuildLeft: 0,
      peakW: 2000000000,
    }));
    state.timeline.forEach((t) => {
      t.demandW = 1000000;
    });
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const lines = state.transmission!.lines;
    expect(now.exportedW).toBeGreaterThan(0);
    expect(lines.some((line) => (line.currentFlowW || 0) < 0)).toBe(true);
    expect(
      lines.reduce((sum, line) => sum + (line.currentFlowW || 0), 0),
    ).toBeCloseTo((now.importedW || 0) - now.exportedW!, 0);
  });

  it("leaves per-line flow alone during a forecast", () => {
    const state = twoIntertiesWithoutPlants();
    state.timeline.forEach((t) => {
      t.demandW = 200000000;
    });
    tickState(state);
    const recorded = state.transmission!.lines.map(
      ({ currentFlowW }) => currentFlowW,
    );
    expect(recorded.some((value) => (value || 0) > 0)).toBe(true);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;

    generateNewTimeline(state, now.cash, now.customers, 8);

    // A forecast dispatches against hypothetical weather; the list must keep showing the
    // trade that actually happened.
    expect(
      state.transmission!.lines.map(({ currentFlowW }) => currentFlowW),
    ).toEqual(recorded);
  });

  it("refreshes per-line flow when the rule changes with the clock paused", () => {
    const state = twoIntertiesWithoutPlants();
    state.timeline.forEach((t) => {
      t.demandW = 200000000;
    });
    tickState(state);
    state.speed = "PAUSED";
    expect(
      state.transmission!.lines.some((line) => (line.currentFlowW || 0) > 0),
    ).toBe(true);

    // Every policy decision is made with the clock stopped, so there is no next real tick to
    // correct a stale reading: the section header says "No power flowing" while the row still
    // shows the megawatts the line was carrying a moment ago.
    const after = cloneDeep(gameReducer(state, setTradingPolicy("CLOSED")));

    expect(after.transmission!.tradingPolicy).toBe("CLOSED");
    after.transmission!.lines.forEach((line) =>
      expect(line.currentFlowW).toBe(0),
    );
  });

  it("imports from the cheaper line first and pays each line its own price", () => {
    const state = twoIntertiesWithoutPlants();
    const { now: upcoming } = nextTick(state);
    const [cheap, dear] = [...lineOffers(state, upcoming)].sort(
      (a, b) => a.pricePerMWh - b.pricePerMWh,
    );
    expect(cheap.pricePerMWh).toBeLessThan(dear.pricePerMWh);
    const dearW = dear.importLimitW / 2;
    const demandW = cheap.importLimitW + dearW;
    state.timeline.forEach((t) => {
      t.demandW = demandW;
    });

    tickState(state);

    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.minute).toBe(upcoming.minute);
    expect(now.importedW).toBeCloseTo(demandW, 0);
    const expectedCost =
      tickMWh(cheap.importLimitW) * cheap.pricePerMWh +
      tickMWh(dearW) * dear.pricePerMWh;
    expect(now.expensesImports).toBeCloseTo(expectedCost, 4);
    // More than the cheap price alone, less than buying everything from the dear line
    expect(now.expensesImports).toBeGreaterThan(
      tickMWh(demandW) * cheap.pricePerMWh,
    );
    expect(now.expensesImports).toBeLessThan(
      tickMWh(demandW) * dear.pricePerMWh,
    );
    expect(now.marketPricePerMWh).toBeCloseTo(
      (cheap.importLimitW * cheap.pricePerMWh + dearW * dear.pricePerMWh) /
        demandW,
      6,
    );
  });

  it("books only the supplying line's emissions when the cheaper line covers the shortage", () => {
    const state = twoIntertiesWithoutPlants();
    const { now: upcoming } = nextTick(state);
    const [cheap, dear] = [...lineOffers(state, upcoming)].sort(
      (a, b) => a.pricePerMWh - b.pricePerMWh,
    );
    expect(cheap.emissionsKgco2ePerMWh).not.toBe(dear.emissionsKgco2ePerMWh);
    const demandW = cheap.importLimitW / 2;
    state.timeline.forEach((t) => {
      t.demandW = demandW;
    });

    tickState(state);

    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.importedW).toBeCloseTo(demandW, 0);
    expect(now.importKgco2ePerMWh).toBe(cheap.emissionsKgco2ePerMWh);
    expect(now.importedKgco2e).toBeCloseTo(
      tickMWh(demandW) * cheap.emissionsKgco2ePerMWh,
      3,
    );
    expect(now.expensesImports).toBeCloseTo(
      tickMWh(demandW) * cheap.pricePerMWh,
      4,
    );
  });

  it("imports less from a peak-sharing neighbour on a hot peak at CEO than at Intern", () => {
    const corridorId = corridorFor("PEAK_SHARING");
    const importedAt = (difficulty: DifficultyType) => {
      const state = buildNorthernIntertie(difficulty);
      state.facilities = [];
      const line = state.transmission!.lines[0];
      line.corridorId = corridorId;
      line.yearsToBuildLeft = 0;
      state.timeline.forEach((t) => {
        t.temperatureC = 40;
        t.solarIrradianceWM2 = 0;
        t.demandW = 20000000000;
      });
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
      const [offer] = lineOffers(state, now);
      expect(now.importedW).toBeCloseTo(
        Math.min(now.demandW, offer.ratingW, offer.importLimitW),
        0,
      );
      return { importedW: now.importedW!, offer, minute: now.minute };
    };
    const intern = importedAt("Intern");
    const ceo = importedAt("CEO");
    expect(ceo.minute).toBe(intern.minute);
    expect(ceo.importedW).toBeLessThan(intern.importedW);
    // Full heat stress takes the difficulty's share of the neighbour's spare supply
    // The market's absolute spare supply is far larger than one line, so the line binds here
    expect(intern.offer.importLimitW).toBeLessThan(
      adjacentMarketForCorridor(corridorId)!.availableSupplyW,
    );
    expect(ceo.importedW / intern.importedW).toBeCloseTo(
      (1 - DIFFICULTIES.CEO.peakSharingImportLoss) /
        (1 - DIFFICULTIES.Intern.peakSharingImportLoss),
      6,
    );
  });
});
