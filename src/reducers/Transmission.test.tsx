import { beginIntertieStress } from "./GameActions";
import { parseSave, serializeSave } from "../SaveGame";
import cloneDeep from "lodash.clonedeep";
import * as transmissionHelpers from "../helpers/Transmission";
import {
  TICKS_PER_YEAR,
  TICKS_PER_MONTH,
  YEARS_PER_TICK,
  TICKS_PER_HOUR,
  GAME_TO_REAL_YEARS,
  DIFFICULTIES,
} from "../Constants";
import {
  getTimeFromTimeline,
  getDateFromMinute,
  MINUTES_PER_MONTH,
  summarizeTimeline,
  summarizeHistory,
} from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import gameReducer, {
  buildTransmissionLine,
  generateNewTimeline,
  generateForecastTimeline,
  setBuyingRule,
  setSellingRule,
  tickState,
  tickStatePhases,
  togglePauseFacility,
  setSpeed,
} from "./Game";
import {
  AppStateType,
  DifficultyType,
  GameType,
  TickPresentFutureType,
  GeneratorOperatingType,
  StorageOperatingType,
} from "../Types";
import { getScenario } from "../data/Scenarios";
import { getCostTableDeflator } from "../data/Economy";
import {
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "../data/AdjacentMarkets";
import { importEmissionsKgco2ePerMWh } from "../data/ImportEmissions";
import { IntertieArchetypeIdType } from "../data/IntertieArchetypes";
import {
  adjacentMarketPricePerMWh,
  intertieImportLimitW,
  intertieContextForGame,
  intertieYear,
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
        importLimitW: intertieImportLimitW(line, context, now.minute, now),
        emissionsKgco2ePerMWh: importEmissionsKgco2ePerMWh(
          market.id,
          intertieYear(now.minute, state.startingYear),
        ),
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

function tradingFixture(withGenerator = false) {
  const state = buildNorthernIntertie();
  state.transmission!.lines[0].yearsToBuildLeft = 0;
  const base = state.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  const generator = {
    ...base,
    id: 1,
    peakW: 100,
    currentW: 100,
    yearsToBuildLeft: 0,
    spinMinutes: 1,
    minimumStableOutput: 0,
    tracksStarts: false,
    btuPerWh: 0,
    variableOperatingCostPerMWh: 0,
    annualOperatingCost: 0,
    paused: false,
  } as GeneratorOperatingType;
  const battery: StorageOperatingType = {
    ...base,
    id: 2,
    name: "Battery",
    peakW: 100,
    peakWh: 1000,
    maxPeakWh: 1000,
    currentW: 0,
    currentWh: 0,
    yearsToBuildLeft: 0,
    paused: false,
    roundTripEfficiency: 0.8,
    hourlyLoss: 0,
    spinMinutes: 1,
  };
  Object.assign(battery, { fuel: undefined });
  state.facilities = withGenerator ? [generator, battery] : [battery];
  state.timeline.forEach((tick) => {
    tick.demandW = 100;
  });
  return { state, generator, battery };
}

describe("independent trading rules", () => {
  it.each(["fuel", "carbon", "inflation", "story"] as const)(
    "rejects extra generation when added %s costs cross the export price",
    (cost) => {
      const price = jest
        .spyOn(transmissionHelpers, "adjacentMarketPricePerMWh")
        .mockReturnValue(100);
      try {
        const make = () => {
          const { state, generator } = tradingFixture(true);
          state.facilities = [generator];
          generator.peakW = 200;
          generator.btuPerWh = 1;
          generator.variableOperatingCostPerMWh = 20;
          state.feePerKgCO2e = 0;
          state.transmission!.sellingRule = "PROFITABLE";
          return { state, generator };
        };
        const cheap = make(),
          expensive = make();
        if (cost === "fuel") expensive.generator.btuPerWh = 1000;
        if (cost === "carbon") expensive.state.feePerKgCO2e = 1000;
        if (cost === "inflation") expensive.generator.costIndexAtBuild = 0.01;
        if (cost === "story")
          expensive.state.worldEvents.active.push({
            key: "trading-operating-cost",
            definitionId: "trading-operating-cost",
            startsMinute: 0,
            endsMinute: 1440,
            attributes: {},
            effects: { operatingCostMultipliersByFuel: { "Natural Gas": 10 } },
          });
        tickState(cheap.state);
        tickState(expensive.state);
        expect(
          getTimeFromTimeline(cheap.state.date.minute, cheap.state.timeline)!
            .exportedW,
        ).toBe(100);
        expect(
          getTimeFromTimeline(
            expensive.state.date.minute,
            expensive.state.timeline,
          )!.exportedW,
        ).toBe(0);
        expect(expensive.generator.currentW).toBe(100);
      } finally {
        price.mockRestore();
      }
    },
  );

  it("shares one generator ramp allowance across peer and external export settlement", () => {
    const price = jest
      .spyOn(transmissionHelpers, "adjacentMarketPricePerMWh")
      .mockReturnValue(100);
    try {
      const { state, generator } = tradingFixture(true);
      state.facilities = [generator];
      state.multiplayer = { seat: "seller", pricePerMWh: 100 };
      state.transmission!.sellingRule = "PROFITABLE";
      generator.peakW = 200;
      generator.spinMinutes = 60;
      const phases = tickStatePhases(state);
      const planned = phases.next();
      expect(planned.done).toBe(false);
      expect(planned.value).toMatchObject({ shortageW: 0 });
      expect(
        phases.next({ importedW: 0, exportedW: 20, importEmissionsKgPerMWh: 0 })
          .done,
      ).toBe(true);
      const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
      expect(generator.currentW).toBe(150);
      expect(now.exportedW).toBe(50);
      expect(state.transmission!.lines[0].currentFlowW).toBe(-30);
    } finally {
      price.mockRestore();
    }
  });
  it.each(["NONE", "SHORTAGES", "SHORTAGES_AND_STORAGE"] as const)(
    "covers customer demand before importing for storage with buying %s",
    (buyingRule) => {
      for (const sellingRule of ["NONE", "SURPLUS", "PROFITABLE"] as const) {
        const { state, battery } = tradingFixture();
        Object.assign(state.transmission!, { buyingRule, sellingRule });
        tickState(state);
        const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
        expect(now.supplyW).toBe(buyingRule === "NONE" ? 0 : 100);
        expect(now.storageImportedW || 0).toBe(
          buyingRule === "SHORTAGES_AND_STORAGE" ? 100 : 0,
        );
        expect(now.importedW).toBe(
          buyingRule === "NONE"
            ? 0
            : buyingRule === "SHORTAGES_AND_STORAGE"
              ? 200
              : 100,
        );
        expect(now.exportedW).toBe(0);
        expect(now.demandW).toBe(100);
        expect(battery.currentWh).toBeCloseTo(
          buyingRule === "SHORTAGES_AND_STORAGE" ? 20 : 0,
        );
        expect(now.storageLossWh).toBeCloseTo(
          buyingRule === "SHORTAGES_AND_STORAGE" ? 5 : 0,
        );
      }
    },
  );

  it("keeps paid storage imports out of customer revenue and native lifetime attribution", () => {
    const baseline = tradingFixture(true);
    const buying = cloneDeep(baseline.state);
    buying.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
    tickState(baseline.state);
    tickState(buying);
    const before = getTimeFromTimeline(
      baseline.state.date.minute,
      baseline.state.timeline,
    )!;
    const after = getTimeFromTimeline(buying.date.minute, buying.timeline)!;
    expect(after.storageImportedW).toBe(100);
    expect(after.revenue).toBe(before.revenue);
    expect(buying.facilities[0].lifetimeRevenue).toBe(
      baseline.state.facilities[0].lifetimeRevenue,
    );
    expect(after.expensesImports).toBeGreaterThan(before.expensesImports);
    expect(after.importedKgco2e).toBeGreaterThan(before.importedKgco2e || 0);
    expect(after.storageChargeW).toBe(100);
    expect(after.reserveW).toBeCloseTo((before.reserveW || 0) + 180);
  });

  it.each([{ paused: true }, { yearsToBuildLeft: 1 }, { currentWh: 1000 }])(
    "does not import into unavailable storage %p",
    (overrides) => {
      const { state, battery } = tradingFixture();
      Object.assign(battery, overrides);
      state.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
      tickState(state);
      expect(
        getTimeFromTimeline(state.date.minute, state.timeline)!
          .storageImportedW,
      ).toBe(0);
    },
  );

  it("does not buy to refill a store that is discharging in the same tick", () => {
    const { state, battery } = tradingFixture();
    battery.currentWh = 100;
    state.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.storageDischargeW).toBe(100);
    expect(now.storageImportedW).toBe(0);
    expect(now.storageChargeW).toBe(0);
  });

  it("changes each rule independently and removes only its own reverted decision", () => {
    let state = buildNorthernIntertie();
    state = cloneDeep(
      gameReducer(state, setBuyingRule("SHORTAGES_AND_STORAGE")),
    );
    state = cloneDeep(gameReducer(state, setSellingRule("NONE")));
    expect(state.transmission).toMatchObject({
      buyingRule: "SHORTAGES_AND_STORAGE",
      sellingRule: "NONE",
    });
    expect(state.meaningfulDecisions.map((d) => d.key)).toEqual(
      expect.arrayContaining(["trading:buying", "trading:selling"]),
    );
    state = cloneDeep(gameReducer(state, setBuyingRule("SHORTAGES")));
    expect(
      state.meaningfulDecisions.some((d) => d.key === "trading:buying"),
    ).toBe(false);
    expect(
      state.meaningfulDecisions.some((d) => d.key === "trading:selling"),
    ).toBe(true);
    expect(state.transmission!.sellingRule).toBe("NONE");
    expect(
      gameReducer(state, { type: setBuyingRule.type, payload: "BAD" }),
    ).toEqual(state);
    expect(
      gameReducer(state, { type: setSellingRule.type, payload: "BAD" }),
    ).toEqual(state);
  });

  it("dispatches profitable output onto the actual paying line and books its added costs", () => {
    const price = jest
      .spyOn(transmissionHelpers, "adjacentMarketPricePerMWh")
      .mockImplementation((id) => (id === "california-north" ? 20 : 80));
    try {
      const { state, generator } = tradingFixture(true);
      state.facilities = [generator];
      generator.peakW = 200;
      generator.variableOperatingCostPerMWh = 50;
      state.transmission!.sellingRule = "PROFITABLE";
      state.transmission!.lines.push({
        ...state.transmission!.lines[0],
        id: 3,
        corridorId: "california-south",
      });
      const baseline = cloneDeep(state);
      baseline.transmission!.sellingRule = "SURPLUS";
      tickState(baseline);
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
      const previous = getTimeFromTimeline(
        baseline.date.minute,
        baseline.timeline,
      )!;
      expect(
        state.transmission!.lines.map((line) => line.currentFlowW),
      ).toEqual([0, -100]);
      expect(generator.currentW).toBe(200);
      expect(now.revenueExports - previous.revenueExports).toBeGreaterThan(
        now.expensesOM - previous.expensesOM,
      );
      expect(now.importedW).toBe(0);
      // A price collapse forbids a new discretionary increment; ordinary output still ramps down.
      price.mockReturnValue(5);
      generator.spinMinutes = 60;
      tickState(state);
      expect(generator.currentW).toBe(150);
      expect(
        getTimeFromTimeline(state.date.minute, state.timeline)!.exportedW,
      ).toBe(50);
    } finally {
      price.mockRestore();
    }
  });

  it("does not start an offline plant solely to sell profitable output", () => {
    const { state, generator } = tradingFixture(true);
    state.facilities = [generator];
    generator.currentW = 0;
    generator.peakW = 200;
    state.transmission!.sellingRule = "PROFITABLE";
    tickState(state);
    expect(generator.currentW).toBe(100);
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)!.exportedW,
    ).toBe(0);
  });

  it("forecasts hourly storage purchases repeatedly without mutating or recharging the live fleet", () => {
    const { state } = tradingFixture();
    state.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
    state.startingDemandScale = 1e-6;
    const original = JSON.stringify(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const first = generateForecastTimeline(
      state,
      now.cash,
      now.customers,
      4,
      60,
    );
    const second = generateForecastTimeline(
      state,
      now.cash,
      now.customers,
      4,
      60,
    );
    expect(first).toEqual(second);
    expect(first.some((tick) => (tick.storageImportedW || 0) > 0)).toBe(true);
    expect(JSON.stringify(state)).toBe(original);
    expect(first.every((tick) => tick.storedWh <= 1000)).toBe(true);
  });

  it("charges purchased storage energy only once across the month-boundary pre-rolls", () => {
    const { state, battery } = tradingFixture();
    state.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
    state.startingDemandScale = 1e-6;
    state.date = getDateFromMinute(MINUTES_PER_MONTH - 15, state.startingYear);
    tickState(state);
    expect(state.date.monthsElapsed).toBe(1);
    expect(battery.currentWh).toBeCloseTo(20);
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)!.storedWh,
    ).toBeCloseTo(20);
  });

  it("gives native and imported charging the same reachable storage reserve", () => {
    const native = tradingFixture(true);
    const imported = tradingFixture(true);
    native.generator.peakW = 150;
    native.generator.currentW = 150;
    native.battery.peakW = 50;
    imported.battery.peakW = 50;
    imported.state.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
    tickState(native.state);
    tickState(imported.state);
    const a = getTimeFromTimeline(
      native.state.date.minute,
      native.state.timeline,
    )!;
    const b = getTimeFromTimeline(
      imported.state.date.minute,
      imported.state.timeline,
    )!;
    expect(a.storageChargeW).toBe(b.storageChargeW);
    expect(a.storedWh).toBe(b.storedWh);
    expect(a.reserveW).toBeCloseTo(b.reserveW || 0);
  });
});

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
        gameReducer(game, setSellingRule("NONE")).transmission,
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
      1000000000 - 54000000 * 0.2,
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
    const next = gameReducer(game, setSellingRule("NONE"));
    expect(next.transmission?.sellingRule).toBe("SURPLUS");
    expect(next.meaningfulDecisions).toEqual([]);
  });

  it("updates and records the trading rule once it governs an intertie", () => {
    const next = gameReducer(buildNorthernIntertie(), setSellingRule("NONE"));
    expect(next.transmission?.sellingRule).toBe("NONE");
    expect(next.meaningfulDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "trading:selling",
          kind: "trading",
          label: "Set the selling rule",
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
      54000000 - debtBefore + principalPaid,
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
    // Authored 2023-dollar O&M, deflated into the scenario's 2020 opening dollars
    expect(now.expensesOM).toBeCloseTo(
      (1080000 * getCostTableDeflator(state.startingYear)) / TICKS_PER_YEAR,
      5,
    );
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

  it("runs Mission 7 from financed build through imports and a later safe export", () => {
    jest.useFakeTimers();
    try {
      const scenario = getScenario(112)!;
      const steps = scenario.tutorialSteps!;
      let state = createGame({ scenarioId: 112 });
      const appState = () => ({ game: state }) as AppStateType;
      expect(state.transmission).toEqual({
        buyingRule: "SHORTAGES",
        sellingRule: "SURPLUS",
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

      state = cloneDeep(gameReducer(state, setSellingRule("NONE")));
      const gas = state.facilities.find(({ fuel }) => fuel === "Natural Gas")!;
      state = cloneDeep(gameReducer(state, togglePauseFacility(gas.id)));
      expect(
        steps
          .find((step) => step.action === "Choose “None” for Selling")!
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
      state = cloneDeep(gameReducer(state, setBuyingRule("NONE")));
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

      state = cloneDeep(
        gameReducer(
          gameReducer(state, setBuyingRule("SHORTAGES")),
          setSellingRule("SURPLUS"),
        ),
      );
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
      // Acknowledgement starts a real dispatch restriction, but inspection cannot run the clock.
      expect(state.tutorialIntertieStress).toBeUndefined();
      state.tutorialStep = steps.findIndex(
        (step) => step.phase === "INTERTIE_STRESS_PREPARE",
      );
      state = cloneDeep(gameReducer(state, beginIntertieStress()));
      expect(state.tutorialIntertieStress?.active).toBe(true);
      const stressMinute = state.date.minute;
      expect(state.timeline.some((t) => t.demandW > t.supplyW)).toBe(true);
      state.tutorialStep = steps.findIndex(
        (step) => step.phase === "INTERTIE_STRESS_INSPECT",
      );
      state = cloneDeep(gameReducer(state, setSpeed("FAST")));
      tickState(state);
      expect(state.speed).toBe("PAUSED");
      expect(state.date.minute).toBe(stressMinute);
      // The exercise is persistent, finite and validated.
      expect(
        parseSave(serializeSave(state))?.game.tutorialIntertieStress,
      ).toEqual(state.tutorialIntertieStress);
      const bad = cloneDeep(state);
      bad.tutorialIntertieStress!.suppliedTicks = Infinity;
      expect(parseSave(serializeSave(bad))).toBeNull();
      state = cloneDeep(gameReducer(state, togglePauseFacility(gas.id)));
      state.tutorialStep = steps.findIndex(
        (step) => step.phase === "INTERTIE_STRESS_SUPPLY",
      );
      const finalCapstone = steps[state.tutorialStep].capstone!;
      expect(finalCapstone.success(appState())).toBe(false);
      for (let i = 0; i < TICKS_PER_MONTH - 1; i++) tickState(state);
      expect(finalCapstone.success(appState())).toBe(false);
      tickState(state);
      expect(finalCapstone.success(appState())).toBe(true);
      expect(state.tutorialIntertieStress?.active).toBe(false);
      expect(state.speed).toBe("PAUSED");
      const restored = getTimeFromTimeline(state.date.minute, state.timeline)!;
      const line = state.transmission!.lines[0];
      expect(
        intertieImportLimitW(
          line,
          intertieContextForGame(state),
          restored.minute,
          restored,
        ),
      ).toBeGreaterThan(150e6);
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
    const intensity = importEmissionsKgco2ePerMWh(
      adjacentMarketForCorridor("california-north")!.id,
      intertieYear(now.minute, state.startingYear),
    );
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

  it("keeps line readings aligned with the current tick at a month boundary", () => {
    const state = twoIntertiesWithoutPlants();
    state.timeline.forEach((t) => {
      t.demandW = 1000000;
    });
    while (state.date.monthsElapsed === 0) tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.importedW).toBeGreaterThan(1000000);
    expect(
      state.transmission!.lines.reduce(
        (sum, line) => sum + (line.currentFlowW || 0),
        0,
      ),
    ).toBeCloseTo((now.importedW || 0) - (now.exportedW || 0), 0);
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
    const after = cloneDeep(gameReducer(state, setBuyingRule("NONE")));

    expect(after.transmission!.buyingRule).toBe("NONE");
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
      line.capacityW = 10e9; // Let neighbor supply, rather than wire rating, bind.
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
