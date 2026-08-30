import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { DifficultyType, GameType, ScenarioType } from "../Types";
import {
  createGame,
  createGameFromReplay,
  runSimulation,
  SimResultType,
} from "./Simulator";
import {
  INTERN_ONE_BUILD_PLAYS,
  STANDARD_BALANCE_PLAYS,
} from "./BalancePlaybooks";
import { loadSimData } from "./SimData";
import { LOCATIONS, TICKS_PER_MONTH } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { tickState } from "../reducers/Game";
import { parseSave, serializeSave } from "../SaveGame";
import { serializeReplay } from "../Replay";
import { getAirborneWindOutputFactor } from "../helpers/Energy";

jest.setTimeout(120000);

// Ticks a state forwards without the simulator around it, for tests that care about where the
// game ends up rather than about how it played
function runMonths(state: GameType, months: number) {
  const until = state.date.monthsElapsed + months;
  while (state.date.monthsElapsed < until) {
    tickState(state);
  }
}

function describeViolations(result: SimResultType): string {
  return result.violations
    .map((v) => `\n  [${v.rule}] ${v.when}: ${v.detail}`)
    .join("");
}

function expectNoViolations(result: SimResultType) {
  expect(
    `${result.violationCount} violations${describeViolations(result)}`,
  ).toBe("0 violations");
}

describe("simulation invariants", () => {
  // Two years is long enough to cover a full weather cycle, construction finishing and loans
  // amortizing, while keeping the whole suite well under a second per scenario
  const MONTHS = 24;

  SCENARIOS.forEach((scenario: ScenarioType) => {
    it(`holds for "${scenario.name}"`, () => {
      expectNoViolations(
        runSimulation({
          scenarioId: scenario.id,
          months: Math.min(MONTHS, scenario.durationMonths),
        }),
      );
    });
  });

  it("holds while building facilities on credit", () => {
    expectNoViolations(
      runSimulation({
        scenarioId: 103, // The Shale Boom -- 20 years, enough room to build repeatedly
        months: 60,
        strategy: "keepUp",
      }),
    );
  });

  // Twenty years of 1980's economy, which is the harshest rate environment the data has: prime
  // opens at 21.5% and every loan signed in the first months is still being paid off at the end.
  // The failure this guards against is a loan whose monthly interest outgrows its payment, which
  // would amortize backwards and never close -- the reason a loan's rate is fixed at origination.
  it("amortizes every loan away over a twenty year run", () => {
    const result = runSimulation({
      scenarioId: 102, // The End of an Era, starting 1980
      months: 240,
      strategy: "keepUp",
    });
    expectNoViolations(result);
    result.finalFacilities.forEach((f) => {
      // Either still under construction, or paying down rather than growing
      expect(f.loanAmountLeft).toBeLessThanOrEqual(f.loanAmountTotal);
      expect(Number.isFinite(f.loanAmountLeft)).toBe(true);
    });
    result.months.forEach((m) => {
      expect(m.interestRate).toBeGreaterThan(0);
      // Prime has reached 21.5% in this era, and a struggling company pays a multiple of it
      expect(m.interestRate).toBeLessThan(1);
      expect(m.inflationRate).toBeGreaterThan(-0.05);
      expect(m.inflationRate).toBeLessThan(0.25);
    });
  });

  it("holds while gaining and losing customers through price competition", () => {
    [0.01, 0.2].forEach((dollarsPerkWh) =>
      expectNoViolations(
        runSimulation({ scenarioId: 101, months: MONTHS, dollarsPerkWh }),
      ),
    );
  });

  (["Intern", "CEO"] as DifficultyType[]).forEach((difficulty) => {
    it(`holds on ${difficulty} difficulty`, () => {
      expectNoViolations(
        runSimulation({ scenarioId: 103, months: MONTHS, difficulty }),
      );
    });
  });

  it("holds across a full 20 year run", () => {
    expectNoViolations(runSimulation({ scenarioId: 102, strategy: "keepUp" }));
  });
});

describe("simulation determinism", () => {
  // Weather, fuel prices and the tick loop all keep module level state. A run that isn't purely a
  // function of its seed means one of them is leaking between games, which would also mean a
  // player's second playthrough silently differs from their first.
  it("produces identical runs for the same seed", () => {
    const options = { scenarioId: 101, months: 24, seed: 777 };
    const first = runSimulation(options);
    const second = runSimulation(options);
    expect(second.months).toEqual(first.months);
    expect(second.finalCash).toEqual(first.finalCash);
  });

  // The seed only feeds the extrapolation past the end of the recorded data (weather runs
  // 1980-2019, fuel prices similar). Inside that window the game replays real history, so two
  // seeds legitimately agree; past it they have to diverge or the seed is being ignored.
  it("produces different runs for different seeds once past the recorded data", () => {
    // Carbon Fee starts in 2020, so every tick is extrapolated
    const first = runSimulation({ scenarioId: 100, months: 24, seed: 1 });
    const second = runSimulation({ scenarioId: 100, months: 24, seed: 2 });
    expect(second.months).not.toEqual(first.months);
  });

  it("replays recorded history identically whatever the seed", () => {
    // Rise of Renewables starts in 2002 and only runs 12 years, well inside the data
    const first = runSimulation({ scenarioId: 101, months: 24, seed: 1 });
    const second = runSimulation({ scenarioId: 101, months: 24, seed: 2 });
    expect(second.months).toEqual(first.months);
  });

  /**
   * The test that makes save/load correct by construction rather than by inspection: a run that is
   * stopped, serialized, has every module level cache thrown away, and is resumed has to match a
   * run that was never interrupted. Weather and fuel prices both live outside the game slice, so
   * this only passes if they rebuild themselves identically from the seed alone.
   */
  it("resumes a serialized game into the run it would have had", () => {
    // Carbon Fee starts in 2020, past the end of both the weather and the fuel price data, so
    // every value the resumed run needs has to be extrapolated rather than read off a CSV
    const options = { scenarioId: 100, seed: 4242 };
    const HALF_MONTHS = 24;

    const uninterrupted = createGame(options);
    runMonths(uninterrupted, HALF_MONTHS * 2);

    const interrupted = createGame(options);
    runMonths(interrupted, HALF_MONTHS);
    // Through the real save envelope, so the shipped serialize/validate path is what's covered
    const parsed = parseSave(
      JSON.parse(JSON.stringify(serializeSave(interrupted))),
    );
    expect(parsed).not.toBeNull();
    const saved: GameType = parsed!.game;
    // Everything a reload throws away: the parsed CSVs, and the forecast weather and prices
    // appended to them
    loadSimData(uninterrupted.location.id);
    runMonths(saved, HALF_MONTHS);

    expect(saved.monthlyHistory).toEqual(uninterrupted.monthlyHistory);
  });

  it("is unaffected by an unrelated run in between", () => {
    const options = { scenarioId: 101, months: 24, seed: 777 };
    const first = runSimulation(options);
    runSimulation({ scenarioId: 104, months: 12, seed: 999 });
    expect(runSimulation(options).months).toEqual(first.months);
  });
});

describe("researched public-utility scenarios", () => {
  const manassas = SCENARIOS.find((scenario) => scenario.id === 106)!;

  it("calibrates Manassas against its authored weather", () => {
    const result = runSimulation({ scenarioId: 106, months: 12 });
    expect(result.months).toHaveLength(12);
    const firstYear = result.months.slice(-12);
    const annualDemandWh = firstYear.reduce(
      (total, month) => total + month.demandWh,
      0,
    );
    const peakDemandW = Math.max(
      ...firstYear.map((month) => month.peakDemandW),
    );

    expect(annualDemandWh).toBeGreaterThanOrEqual(394_000_000e3);
    expect(annualDemandWh).toBeLessThanOrEqual(455_000_000e3);
    expect(peakDemandW).toBeGreaterThanOrEqual(70_000_000);
    expect(peakDemandW).toBeLessThanOrEqual(80_000_000);
    const state = createGame({ scenarioId: 106 });
    expect(
      state.facilities.find((facility) => facility.fuel === "Natural Gas")
        ?.name,
    ).toBe("Purchased Power Proxy");
    expect(
      state.timeline.every((tick) => tick.demandByType["Data centers"] === 0),
    ).toBe(true);
    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(state))),
    )!.game;
    expect(restored.startingDemandScale).toBe(7.5);
    expect(restored.loadAdditions).toEqual(manassas.loadAdditions);
    const replayed = createGameFromReplay(serializeReplay(state)!);
    expect(replayed.startingDemandScale).toBe(7.5);
    expect(replayed.loadAdditions).toEqual(manassas.loadAdditions);
    expect(replayed.timeline).toEqual(state.timeline);
  });

  it("records only completed Manassas months across new game, save and replay", () => {
    const fresh = createGame({ scenarioId: 106 });
    expect(fresh.monthlyHistory).toEqual([]);
    runMonths(fresh, 1);
    expect(fresh.monthlyHistory).toHaveLength(1);
    expect(fresh.monthlyHistory[0]).toMatchObject({ year: 2020, month: 1 });

    const uninterrupted = createGame({ scenarioId: 106 });
    runMonths(uninterrupted, 73);
    const boundary = createGame({ scenarioId: 106 });
    runMonths(boundary, 71); // December 2025, immediately before the authored load arrives
    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(boundary))),
    )!.game;
    runMonths(restored, 2);
    expect(restored.monthlyHistory).toEqual(uninterrupted.monthlyHistory);

    const replayed = createGameFromReplay(serializeReplay(boundary)!);
    runMonths(replayed, 73);
    expect(replayed.monthlyHistory).toEqual(uninterrupted.monthlyHistory);

    const full = runSimulation({
      scenarioId: 106,
      initialBuild: {
        name: "Natural Gas",
        peakW: 50_000_000,
        financed: true,
      },
    });
    expect(full.months).toHaveLength(192);
    expect(full.months[0]).toMatchObject({ year: 2020, month: 1 });
    expect(full.months[191]).toMatchObject({ year: 2035, month: 12 });
    expect(
      new Set(full.months.map((month) => `${month.year}-${month.month}`)).size,
    ).toBe(192);
  });

  it("defaults demand calibration to one and applies it to the whole forecast", () => {
    const base: ScenarioType = {
      id: CUSTOM_SCENARIO_ID,
      name: "Demand calibration fixture",
      icon: "natural gas",
      locationId: "SF",
      location: LOCATIONS.SF,
      ownership: "Public",
      startingYear: 2019,
      startingCustomers: 10_000,
      cash: 1_000_000,
      dollarsPerkWh: 0.1,
      durationMonths: 1,
      feePerKgCO2e: 0,
      facilities: [],
    };
    const defaultScale = createGame({ scenarioId: base.id, scenario: base });
    const explicitOne = createGame({
      scenarioId: base.id,
      scenario: { ...base, startingDemandScale: 1 },
    });
    const doubled = createGame({
      scenarioId: base.id,
      scenario: { ...base, startingDemandScale: 2 },
    });

    expect(defaultScale.startingDemandScale).toBe(1);
    expect(defaultScale.timeline.map((tick) => tick.demandW)).toEqual(
      explicitOne.timeline.map((tick) => tick.demandW),
    );
    doubled.timeline.forEach((tick, index) => {
      expect(tick.demandW).toBeCloseTo(
        defaultScale.timeline[index].demandW * 2,
      );
    });
  });

  it("calibrates Austin's first full modeled year to FY2017 energy and peak", () => {
    const result = runSimulation({ scenarioId: 107, months: 12 });
    // The simulator records an opening forecast row before its first rollover; the trailing twelve
    // rows are the first complete January-December operating year.
    const firstYear = result.months.slice(-12);
    const annualDemandWh = firstYear.reduce(
      (total, month) => total + month.demandWh,
      0,
    );
    const peakDemandW = Math.max(
      ...firstYear.map((month) => month.peakDemandW),
    );
    expect(annualDemandWh).toBeGreaterThanOrEqual(13_010_291e6 * 0.9);
    expect(annualDemandWh).toBeLessThanOrEqual(13_010_291e6 * 1.1);
    expect(peakDemandW).toBeGreaterThanOrEqual(2_654_000_000 * 0.9);
    expect(peakDemandW).toBeLessThanOrEqual(2_654_000_000 * 1.1);
  });

  it("reproduces Uri once across forecast, save and replay, then expires every effect", () => {
    const event = createGame({ scenarioId: 107 });
    const control = createGame({
      scenarioId: 107,
      storyEffectsEnabled: false,
    });
    runMonths(event, 49);
    runMonths(control, 49);

    expect(event.date).toMatchObject({ year: 2021, monthNumber: 2 });
    expect(
      event.worldEvents.active.map((occurrence) => occurrence.key),
    ).toEqual(["story:107:texas-deep-freeze:uri"]);
    const minimumTemperatureC = Math.min(
      ...event.timeline.map((tick) => tick.temperatureC),
    );
    expect(minimumTemperatureC).toBeGreaterThanOrEqual(-16.5);
    expect(minimumTemperatureC).toBeLessThanOrEqual(-12.5);
    expect(
      Math.min(...event.timeline.map((tick) => tick.supplyW - tick.demandW)),
    ).toBeLessThan(100_000_000);

    event.timeline
      .map((tick, index) => ({
        actual: tick.supplyByFuel.Wind || 0,
        expected: control.timeline[index].supplyByFuel.Wind || 0,
      }))
      .filter(({ expected }) => expected > 0)
      .forEach(({ actual, expected }) => {
        expect(actual).toBeCloseTo(expected * 0.44, -2);
      });
    event.timeline.forEach((tick, index) => {
      expect(tick["Natural Gas"]).toBeCloseTo(
        control.timeline[index]["Natural Gas"]! * 2.8,
      );
    });

    const restored = parseSave(
      JSON.parse(JSON.stringify(serializeSave(event))),
    )!.game;
    expect(restored.startingDemandScale).toBe(event.startingDemandScale);
    expect(restored.loadAdditions).toEqual(event.loadAdditions);
    expect(restored.worldEvents).toEqual(event.worldEvents);

    const replay = serializeReplay(event)!;
    const replayed = createGameFromReplay(replay);
    runMonths(replayed, 49);
    expect(replayed.timeline).toEqual(event.timeline);
    expect(replayed.worldEvents).toEqual(event.worldEvents);

    runMonths(event, 1);
    runMonths(control, 1);
    expect(event.date).toMatchObject({ year: 2021, monthNumber: 3 });
    expect(
      event.worldEvents.active.map((occurrence) => occurrence.key),
    ).toEqual(["story:107:texas-deep-freeze:thaw"]);
    expect(
      event.worldEvents.occurrences.map((occurrence) => occurrence.key),
    ).toEqual([
      "story:107:texas-deep-freeze:uri",
      "story:107:texas-deep-freeze:thaw",
    ]);
    event.timeline.forEach((tick, index) => {
      // Different February dispatch changes cumulative emissions slightly; the 20°C event offset
      // itself is gone, leaving only that normal climate-forcing consequence.
      expect(
        Math.abs(tick.temperatureC - control.timeline[index].temperatureC),
      ).toBeLessThan(0.1);
      expect(tick["Natural Gas"]).toBe(control.timeline[index]["Natural Gas"]);
    });
  });

  const difficulties: DifficultyType[] = [
    "Intern",
    "Employee",
    "Manager",
    "VP",
    "CEO",
  ];
  it.each(difficulties)(
    "completes Data Center Boom on %s with capacity planned before the arrival",
    (difficulty) => {
      const result = runSimulation({
        scenarioId: 106,
        difficulty,
        initialBuild: {
          name: "Natural Gas",
          peakW: 50_000_000,
          financed: true,
        },
      });
      expectNoViolations(result);
      expect(result.outcome).toBe("completed");
    },
  );

  it.each(difficulties)(
    "rejects passive customer attrition as a Data Center Boom win on %s",
    (difficulty) => {
      const result = runSimulation({ scenarioId: 106, difficulty });
      expectNoViolations(result);
      expect(result.outcome).toBe("fired");
      expect(result.months[result.months.length - 1].customers).toBeLessThan(
        manassas.startingCustomers! * manassas.minimumCustomerRetention!,
      );
    },
  );

  it.each(difficulties)(
    "keeps Texas Deep Freeze mathematically survivable on %s",
    (difficulty) => {
      const result = runSimulation({ scenarioId: 107, difficulty });
      expectNoViolations(result);
      expect(result.outcome).toBe("completed");
    },
  );

  it("supports materially different Manager strategies for Data Center Boom", () => {
    const leanPlan = runSimulation({
      scenarioId: 106,
      difficulty: "Manager",
      initialBuild: {
        name: "Natural Gas",
        peakW: 40_000_000,
        financed: true,
      },
    });
    const reservePlan = runSimulation({
      scenarioId: 106,
      difficulty: "Manager",
      initialBuild: {
        name: "Natural Gas",
        peakW: 50_000_000,
        financed: true,
      },
    });
    expect(leanPlan.outcome).toBe("completed");
    expect(reservePlan.outcome).toBe("completed");
    expect(leanPlan.builds[0].buildCost).not.toBe(
      reservePlan.builds[0].buildCost,
    );
  });

  it("supports materially different Manager strategies for Texas Deep Freeze", () => {
    const existingPortfolio = runSimulation({
      scenarioId: 107,
      difficulty: "Manager",
    });
    const extraWind = runSimulation({
      scenarioId: 107,
      difficulty: "Manager",
      initialBuild: { name: "Wind", peakW: 250_000_000, financed: true },
    });
    expect(existingPortfolio.outcome).toBe("completed");
    expect(extraWind.outcome).toBe("completed");
    expect(existingPortfolio.builds).toHaveLength(0);
    expect(extraWind.builds).toHaveLength(1);
  });
});

describe("hydro dispatch", () => {
  const scenario: ScenarioType = {
    id: 9999,
    name: "Hydro test basin",
    icon: "hydro",
    locationId: "SF",
    location: LOCATIONS.SF,
    ownership: "Public",
    startingYear: 2002,
    cash: 500_000_000,
    startingCustomers: 250_000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.1,
    durationMonths: 24,
    facilities: [{ fuel: "Hydro", peakW: 150_000_000 }],
  };

  function hydroGame() {
    return createGame({ scenarioId: scenario.id, scenario });
  }

  it("holds the water-balance invariants across wet and dry seasons", () => {
    expectNoViolations(
      runSimulation({ scenarioId: scenario.id, scenario, months: 24 }),
    );
  });

  it("turns water-rights flow into must-run power above the dead pool", () => {
    const state = hydroGame();
    const hydro = state.facilities.find((f) => f.fuel === "Hydro")!;
    hydro.reservoirWh = hydro.reservoirCapacityWh;
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.hydroMandatedReleaseW).toBeGreaterThan(0);
    expect(now.supplyByFuel.Hydro).toBeGreaterThanOrEqual(
      now.hydroMandatedReleaseW,
    );
    expect(hydro.reservoirWh).toBeLessThan(hydro.reservoirCapacityWh!);
  });

  it("stops producing below minimum power pool while required releases continue", () => {
    const state = hydroGame();
    const hydro = state.facilities.find((f) => f.fuel === "Hydro")!;
    hydro.reservoirWh = hydro.reservoirCapacityWh! * 0.05;
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.supplyByFuel.Hydro || 0).toBe(0);
    expect(hydro.hydroLastBypassWh).toBeGreaterThan(0);
  });

  it("keeps paused reservoirs visible while required releases bypass the turbine", () => {
    const state = hydroGame();
    const hydro = state.facilities.find((f) => f.fuel === "Hydro")!;
    hydro.paused = true;
    const before = hydro.reservoirWh!;
    tickState(state);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    expect(now.supplyByFuel.Hydro || 0).toBe(0);
    expect(now.hydroReservoirWh).toBe(hydro.reservoirWh);
    expect(now.hydroReservoirCapacityWh).toBe(hydro.reservoirCapacityWh);
    expect(hydro.reservoirWh).not.toBe(before);
    expect(hydro.hydroLastBypassWh).toBeGreaterThan(0);
  });
});

describe("airborne wind dispatch", () => {
  const location = {
    id: "Lista",
    name: "Lista, Norway",
    lat: 58.109,
    long: 6.567,
    timeZone: "Europe/Oslo",
    region: "Europe",
    country: "Norway",
  };
  const scenario: ScenarioType = {
    id: CUSTOM_SCENARIO_ID,
    name: "Airborne Wind test",
    icon: "wind",
    locationId: "Lista",
    location,
    ownership: "Public",
    startingYear: 2030,
    cash: 100000000,
    startingCustomers: 10000,
    feePerKgCO2e: 0,
    dollarsPerkWh: 0.1,
    durationMonths: 12,
    facilities: [{ fuel: "Airborne Wind", peakW: 1000000 }],
  };

  it("uses the Airborne Wind curve as intermittent must-run supply", () => {
    const state = createGame({ scenarioId: scenario.id, scenario });
    const productive = state.timeline.find(
      (tick) => (tick.supplyByFuel["Airborne Wind"] || 0) > 0,
    );
    expect(productive).toBeDefined();
    expect(productive!.supplyByFuel["Airborne Wind"]).toBeCloseTo(
      1000000 * getAirborneWindOutputFactor(productive!.windAirborneKph),
      -2,
    );
    expect(productive!.supplyByFuel["Airborne Wind"]).toBeGreaterThan(0);
  });

  it("round-trips its facility and reference wind through a save", () => {
    const state = createGame({ scenarioId: scenario.id, scenario });
    const parsed = parseSave(
      JSON.parse(JSON.stringify(serializeSave(state))),
    )!.game;
    expect(parsed.facilities[0].fuel).toBe("Airborne Wind");
    expect(parsed.timeline[0].windAirborneKph).toBe(
      state.timeline[0].windAirborneKph,
    );
  });
});

describe("simulation economics", () => {
  SCENARIOS.filter(
    (scenario) => !scenario.tutorialSteps && scenario.id < 106,
  ).forEach((scenario) => {
    it(`fails passively but needs only one build on Intern in "${scenario.name}"`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(0);
      expect(passive.outcome).not.toBe("completed");

      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
        ...INTERN_ONE_BUILD_PLAYS[scenario.id],
      });
      expectNoViolations(active);
      expect(active.actionCount).toBe(1);
      expect(active.builds).toHaveLength(1);
      expect(active.outcome).toBe("completed");
    });
  });

  SCENARIOS.filter(
    (scenario) => !scenario.tutorialSteps && scenario.id < 106,
  ).forEach((scenario) => {
    it(`rejects passive play and accepts a multi-action plan in "${scenario.name}" on CEO`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(0);
      expect(passive.outcome).not.toBe("completed");

      const play = STANDARD_BALANCE_PLAYS[scenario.id];
      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
        ...play,
      });
      expectNoViolations(active);
      expect(active.actionCount).toBeGreaterThanOrEqual(3);
      expect(active.outcome).toBe("completed");
    });
  });

  it("makes a replacement build necessary at the End of an Era compliance deadline", () => {
    const shortcut = runSimulation({
      scenarioId: 102,
      difficulty: "CEO",
      dollarsPerkWh: 0.15,
      sellFacilityId: 1,
      sellAtMonth: 39,
    });
    expectNoViolations(shortcut);
    expect(shortcut.actionCount).toBe(2);
    expect(shortcut.outcome).not.toBe("completed");
  });

  it("makes storm hardening necessary on Hurricane Season CEO", () => {
    const shortcut = runSimulation({
      scenarioId: 104,
      difficulty: "CEO",
      dollarsPerkWh: 0.08,
    });
    expectNoViolations(shortcut);
    expect(shortcut.actionCount).toBe(1);
    expect(shortcut.outcome).not.toBe("completed");
  });

  it("bills every customer it supplies at the going rate", () => {
    const result = runSimulation({
      scenarioId: 101,
      months: 12,
      dollarsPerkWh: 0.1,
    });
    // The first month summarizes the timeline initGame built, before the rate was overridden --
    // the same way a player's history keeps whatever rate was in force when it was recorded
    expect(result.months.length).toBeGreaterThan(2);
    result.months.slice(1).forEach((m) => {
      expect(m.revenue / (m.supplyWh / 1000)).toBeCloseTo(0.1, 6);
    });
  });

  it("starts at the rate its scenario advertises", () => {
    const result = runSimulation({ scenarioId: 101, months: 6 });
    const scenarioRate = result.scenario.dollarsPerkWh;
    result.months.forEach((m) => {
      expect(m.revenue / (m.supplyWh / 1000)).toBeCloseTo(scenarioRate, 6);
    });
  });

  it("charges more for the same electricity at a higher rate", () => {
    const cheap = runSimulation({
      scenarioId: 101,
      months: 12,
      dollarsPerkWh: 0.05,
    });
    const pricey = runSimulation({
      scenarioId: 101,
      months: 12,
      dollarsPerkWh: 0.1,
    });
    const revenue = (r: SimResultType) =>
      r.months.reduce((a, m) => a + m.revenue, 0);
    expect(revenue(pricey)).toBeGreaterThan(revenue(cheap));
  });

  it("moves investor customers toward a cheaper utility and away from a dearer one", () => {
    const customersAt = (dollarsPerkWh: number) =>
      runSimulation({ scenarioId: 101, months: 12, dollarsPerkWh }).months.at(
        -1,
      )!.customers;
    expect(customersAt(0.05)).toBeGreaterThan(customersAt(0.07));
    expect(customersAt(0.07)).toBeGreaterThan(customersAt(0.1));
  });

  it("keeps public customer growth independent of the rate", () => {
    const customersAt = (dollarsPerkWh: number) =>
      runSimulation({ scenarioId: 104, months: 12, dollarsPerkWh }).months.at(
        -1,
      )!.customers;
    expect(customersAt(0.02)).toBe(customersAt(0.2));
  });

  /**
   * This used to run scenario 5 and assert zero emissions only `if` that run's fleet turned out
   * to be renewables-only. Scenario 5 starts on a 450MW coal plant, so the condition was never
   * true and the assertion never ran. Build the fleet the test wants rather than hoping a
   * scenario supplies one.
   */
  it("emits nothing when only renewables are running", () => {
    // Paradise is the one scenario that starts with both wind and solar
    const state = createGame({ scenarioId: 105 });
    state.facilities = state.facilities.filter(
      (f) => f.fuel === "Sun" || f.fuel === "Wind",
    );
    expect(state.facilities.length).toBeGreaterThan(0);

    let generatedW = 0;
    let kgco2e = 0;
    for (let i = 0; i < TICKS_PER_MONTH; i++) {
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline);
      if (now) {
        generatedW += now.supplyW;
        kgco2e += now.kgco2e;
      }
    }

    // Without this the test would also pass on a fleet that never generated anything
    expect(generatedW).toBeGreaterThan(0);
    expect(kgco2e).toBe(0);
  });

  it("keeps the carbon fee proportional to emissions", () => {
    // Carbon Fee is the one scenario that starts with a non-zero feePerKgCO2e
    const result = runSimulation({ scenarioId: 100, months: 24 });
    const fee = result.scenario.feePerKgCO2e;
    expect(fee).toBeGreaterThan(0);
    result.months.forEach((m) => {
      expect(m.expensesCarbonFee).toBeCloseTo(m.kgco2e * fee, 4);
    });
  });
});
