import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from "../Constants";
import {
  deriveExpandedSummary,
  getTimeFromTimeline,
} from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import gameReducer, {
  buildFacility,
  generateNewTimeline,
  tickState,
  setTradingPolicy,
} from "./Game";
import { GameType, GeneratorShoppingType } from "../Types";
import { GENERATORS, constructionKgco2eCurve } from "../data/Facilities";
import { corridorConstructionKgco2e } from "../helpers/Transmission";
import { TRANSMISSION_CORRIDORS } from "../data/AdjacentMarkets";
import { validBuildFacility } from "../helpers/BuildValidation";

function richGame(scenarioId = 100): GameType {
  const game = createGame({ scenarioId, seed: 61 });
  getTimeFromTimeline(game.date.minute, game.timeline)!.cash = 100000000000;
  return game;
}

/** A quote from the live catalogue, so the test buys exactly what a player would. */
function quoteFor(game: GameType, name: string, peakW: number) {
  const flat = new Array(TICKS_PER_YEAR).fill(0);
  const generator = GENERATORS(game, peakW, flat, flat, flat, flat).find(
    (g: GeneratorShoppingType) => g.name === name,
  );
  if (!generator) throw new Error(`${name} is not buildable here`);
  return generator;
}

/**
 * What the run has recorded as construction emissions so far. Read from the monthly history
 * rather than the live timeline: the history is what the score, the charts and the debrief all
 * consume, and the timeline only holds the current day.
 */
function recordedConstructionKgco2e(state: GameType): number {
  return state.monthlyHistory.reduce(
    (total, month) => total + (month.constructionKgco2e || 0),
    0,
  );
}

function runMonths(state: GameType, months: number) {
  for (let i = 0; i < months * TICKS_PER_MONTH; i++) tickState(state);
}

describe("construction emissions", () => {
  it("gives every build option a construction figure", () => {
    const game = richGame();
    const flat = new Array(TICKS_PER_YEAR).fill(0);
    const generators = GENERATORS(game, 100000000, flat, flat, flat, flat);
    expect(generators.length).toBeGreaterThan(3);
    generators.forEach((g: GeneratorShoppingType) => {
      expect(g.constructionKgco2ePerW).toBeGreaterThan(0);
    });
  });

  it("emits the whole total across construction, and not one gram after", () => {
    let state = richGame();
    const quote = quoteFor(state, "Wind", 100000000);
    state = cloneDeep(
      gameReducer(state, buildFacility({ facility: quote, financed: false })),
    );
    const built = state.facilities.find((f) => f.name === "Wind")!;
    const expected = built.constructionKgco2eTotal!;
    expect(expected).toBeCloseTo(0.42 * 100000000, 0);

    // Run well past completion, so anything still accruing afterwards would show up.
    runMonths(state, Math.ceil(built.yearsToBuild * 12) + 6);
    expect(
      state.facilities.find((f) => f.name === "Wind")!.yearsToBuildLeft,
    ).toBe(0);
    // What the plant was charged is exact: a build emits its total, no more and no less. This is
    // the property that makes the accrual trustworthy, and it holds because each tick charges
    // for progress made rather than for time elapsed.
    const built2 = state.facilities.find((f) => f.name === "Wind")!;
    expect(built2.constructionKgco2eEmitted).toBeCloseTo(expected, 6);

    expect(recordedConstructionKgco2e(state)).toBeCloseTo(expected, 5);
  });

  it("finishes accruing a facility that completes during month-boundary pre-roll", () => {
    let state = richGame();
    const quote = quoteFor(state, "Wind", 100000000);
    quote.yearsToBuild = (TICKS_PER_MONTH + 2) / TICKS_PER_YEAR;
    state = cloneDeep(
      gameReducer(state, buildFacility({ facility: quote, financed: false })),
    );
    const expected = state.facilities.find(
      (f) => f.name === "Wind",
    )!.constructionKgco2eTotal!;
    runMonths(state, 3);
    expect(
      state.facilities.find((f) => f.name === "Wind")!
        .constructionKgco2eEmitted,
    ).toBeCloseTo(expected, 5);
    expect(recordedConstructionKgco2e(state)).toBeCloseTo(expected, 5);
  });

  it("does not rewrite already-booked construction emissions when reforecasting", () => {
    let state = richGame();
    state = cloneDeep(
      gameReducer(
        state,
        buildFacility({
          facility: quoteFor(state, "Wind", 100000000),
          financed: false,
        }),
      ),
    );
    for (let i = 0; i < 5; i++) tickState(state);
    const booked = getTimeFromTimeline(
      state.date.minute,
      state.timeline,
    )!.constructionKgco2e;
    state = cloneDeep(
      gameReducer(
        state,
        buildFacility({
          facility: quoteFor(state, "Solar", 500000000),
          financed: false,
        }),
      ),
    );
    state = cloneDeep(gameReducer(state, setTradingPolicy("CLOSED")));
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)!
        .constructionKgco2e,
    ).toBe(booked);
    const expected = state.facilities.reduce(
      (sum, f) => sum + (f.constructionKgco2eTotal || 0),
      0,
    );
    runMonths(state, 36);
    expect(recordedConstructionKgco2e(state)).toBeCloseTo(expected, 5);
  });

  it("forecasts the full remaining embodied total without booking it in the live game", () => {
    let state = richGame();
    state = cloneDeep(
      gameReducer(
        state,
        buildFacility({
          facility: quoteFor(state, "Wind", 100000000),
          financed: false,
        }),
      ),
    );
    for (let i = 0; i < 20; i++) tickState(state);
    const asset = state.facilities.find((f) => f.name === "Wind")!;
    const before = cloneDeep(asset);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const forecast = generateNewTimeline(
      state,
      now.cash,
      now.customers,
      TICKS_PER_YEAR * 2,
    );
    const remaining = forecast
      .filter((t) => t.minute > state.date.minute)
      .reduce((sum, t) => sum + (t.constructionKgco2e || 0), 0);
    expect(remaining).toBeCloseTo(
      asset.constructionKgco2eTotal! - asset.constructionKgco2eEmitted!,
      5,
    );
    expect(asset).toEqual(before);
  });

  it("keeps construction emissions out of the carbon fee", () => {
    let state = richGame();
    state.feePerKgCO2e = 0.05;
    const quote = quoteFor(state, "Solar", 500000000);
    state = cloneDeep(
      gameReducer(state, buildFacility({ facility: quote, financed: false })),
    );

    let sawConstruction = false;
    for (let i = 0; i < TICKS_PER_MONTH * 6; i++) {
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
      if ((now.constructionKgco2e || 0) > 0) sawConstruction = true;
      // The fee is charged on what the grid burned, which is the local term alone -- not the
      // headline total, and not the imported term either. A solar farm going up adds to the
      // headline and must leave the bill untouched.
      expect(now.expensesCarbonFee).toBeCloseTo(
        state.feePerKgCO2e * (now.localKgco2e || 0),
        6,
      );
      expect(now.kgco2e).toBeCloseTo(
        (now.localKgco2e || 0) +
          (now.importedKgco2e || 0) +
          (now.constructionKgco2e || 0),
        6,
      );
    }
    expect(sawConstruction).toBe(true);
  });

  it("leaves emissions per MWh an intensity of what was delivered", () => {
    let state = richGame();
    runMonths(state, 2);
    const before = deriveExpandedSummary(state.monthlyHistory[0]);

    const quote = quoteFor(state, "Nuclear", 1000000000);
    state = cloneDeep(
      gameReducer(state, buildFacility({ facility: quote, financed: true })),
    );
    runMonths(state, 2);
    const during = deriveExpandedSummary(state.monthlyHistory[0]);

    // A reactor going up is a large embodied total against a month of unchanged generation.
    expect(during.constructionKgco2e || 0).toBeGreaterThan(0);
    // Emissions per MWh answers "how dirty was the electricity" -- construction emissions
    // belong to a schedule, not to the megawatt-hours one month happened to deliver, so they
    // must not appear in the numerator and spike every month somebody broke ground in.
    const operational =
      (during.localKgco2e || 0) + (during.importedKgco2e || 0);
    expect(during.kgco2ePerMWh).toBeCloseTo(
      operational / (during.supplyWh / 1000000),
      6,
    );
    // The reactor's embodied total is large against one month of unchanged generation, so
    // including it would have moved the intensity by far more than generation drifts.
    expect(during.kgco2e).toBeGreaterThan(operational);
    expect(during.kgco2ePerMWh).toBeLessThan(before.kgco2ePerMWh * 1.05);
  });

  it("keeps what a cancelled build already emitted", () => {
    let state = richGame();
    const quote = quoteFor(state, "Coal", 200000000);
    state = cloneDeep(
      gameReducer(state, buildFacility({ facility: quote, financed: false })),
    );
    runMonths(state, 3);
    const emitted = recordedConstructionKgco2e(state);
    expect(emitted).toBeGreaterThan(0);

    // Cancelling refunds money, never emissions: the steel was already made.
    const sold = state.facilities.find((f) => f.name === "Coal")!;
    expect(sold.yearsToBuildLeft).toBeGreaterThan(0);
    state.facilities = state.facilities.filter((f) => f.id !== sold.id);
    const completedMonths = state.monthlyHistory.length;
    runMonths(state, 3);

    // Nothing is refunded: what the run already booked stays booked.
    expect(recordedConstructionKgco2e(state)).toBeGreaterThanOrEqual(emitted);
    // And nothing further accrues. Every month that completed after the cancellation is clean;
    // the month the cancellation fell inside keeps the share it had already emitted.
    const since = state.monthlyHistory.slice(
      0,
      state.monthlyHistory.length - completedMonths - 1,
    );
    expect(since.length).toBeGreaterThan(0);
    since.forEach((month) => expect(month.constructionKgco2e || 0).toBe(0));
  });

  it("charges the starting fleet nothing, having been built before the run", () => {
    const state = richGame();
    expect(state.facilities.length).toBeGreaterThan(0);
    state.facilities.forEach((f) => {
      expect(f.yearsToBuildLeft).toBe(0);
      expect(f.constructionKgco2eTotal).toBe(0);
    });
    runMonths(state, 3);
    expect(recordedConstructionKgco2e(state)).toBe(0);
  });

  it("locks a quote's vintage rather than tracking later improvements", () => {
    const early = quoteFor(richGame(), "Solar", 100000000);
    const lateGame = richGame();
    lateGame.date.year += 20;
    const late = quoteFor(lateGame, "Solar", 100000000);
    expect(late.constructionKgco2ePerW).toBeLessThan(
      early.constructionKgco2ePerW!,
    );
  });

  it("decays declining technologies toward a floor rather than through it", () => {
    // A flat annual percentage is what this shape exists to avoid: compounded over a long run
    // it passes below what the required mass of silicon and steel can physically emit.
    const floor = 0.12;
    const far = constructionKgco2eCurve(2200, 0.6, 2025, 0.055, floor);
    expect(far).toBeGreaterThan(floor);
    expect(far).toBeCloseTo(floor, 3);
    expect(constructionKgco2eCurve(2020, 0.6, 2025, 0.055, floor)).toBe(0.6);
    expect(constructionKgco2eCurve(2100, 0.32, 2025, 0, 0)).toBe(0.32);
  });

  it("prices an existing corridor below a new one per watt", () => {
    const existing = TRANSMISSION_CORRIDORS.find(
      (c) => c.id === "california-north",
    )!;
    const fresh = TRANSMISSION_CORRIDORS.find(
      (c) => c.id === "california-south",
    )!;
    const perW = (c: typeof existing) =>
      corridorConstructionKgco2e(c) / c.capacityW;
    expect(existing.routeType).toBe("EXISTING");
    expect(fresh.routeType).toBe("NEW");
    expect(perW(existing)).toBeLessThan(perW(fresh));

    // Absolute magnitude, not just the ordering. A line is metal-heavy per kilometre but
    // metal-light per watt, because one circuit moves gigawatts: every corridor should land
    // between simple-cycle gas at 0.06 and nuclear at 0.30, and well under onshore wind's 0.42.
    TRANSMISSION_CORRIDORS.forEach((c) => {
      expect(corridorConstructionKgco2e(c) / c.capacityW).toBeGreaterThan(0.02);
      expect(corridorConstructionKgco2e(c) / c.capacityW).toBeLessThan(0.3);
    });
    // Damped, not linear: cost carries route length, but the land, permits and lawyers that
    // make an expensive corridor expensive emit almost nothing.
    const costRatio =
      fresh.buildCost /
      fresh.capacityW /
      (existing.buildCost / existing.capacityW);
    expect(perW(fresh) / perW(existing)).toBeLessThan(costRatio / 0.7);
  });

  it("refuses a quote claiming absurd embodied emissions", () => {
    const game = richGame();
    const facility = quoteFor(game, "Wind", 100000000);
    expect(validBuildFacility({ facility, financed: false })).toBe(true);
    // Replay documents are untrusted, and this number lands straight in the run's score.
    expect(
      validBuildFacility({
        facility: { ...facility, constructionKgco2ePerW: 1e9 },
        financed: false,
      }),
    ).toBe(false);
    expect(
      validBuildFacility({
        facility: { ...facility, constructionKgco2ePerW: -1 },
        financed: false,
      }),
    ).toBe(false);
  });
});
