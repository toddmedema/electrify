import { LOCATIONS } from "../Constants";
import { CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { getAirborneWindOutputFactor } from "../helpers/Energy";
import { tickState } from "../reducers/Game";
import { parseSave, serializeSave } from "../SaveGame";
import { DifficultyType, GameType, ScenarioType } from "../Types";
import { loadSimData } from "./SimData";
import { expectNoViolations, runMonths } from "./SimulationTestHelpers";
import { createGame, runSimulation } from "./Simulator";

jest.setTimeout(120000);

describe("simulation invariants", () => {
  // Two years is long enough to cover a full weather cycle, construction finishing and loans
  // amortizing, while keeping the whole suite well under a second per scenario
  const MONTHS = 24;

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
});

describe("simulation determinism", () => {
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
