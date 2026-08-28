import { LOCATIONS } from "../Constants";
import { CUSTOM_SCENARIO_ID, DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { getPlayedScenarioIds } from "../LocalStorage";
import { createGame, runSimulation } from "../testing/Simulator";
import {
  FacilityOperatingType,
  LocationType,
  MonthlyHistoryType,
  ScenarioType,
} from "../Types";

// The settings a player might pick on the custom game screen, all different from both the slice
// defaults and the first authored scenario, which is what a broken lookup falls back to
const CUSTOM = {
  ...DEFAULT_CUSTOM_SCENARIO,
  locationId: "PIT",
  ownership: "Public",
  startingYear: 1990,
  cash: 500000000,
  dollarsPerkWh: 0.1,
  feePerKgCO2e: 50 / 1000,
  durationMonths: 12 * 5,
  seed: 1234,
  facilities: [
    { name: "Coal", peakW: 200000000 },
    { name: "Pumped Hydro", peakWh: 500000000 },
  ],
} as ScenarioType;

describe("a custom game", () => {
  it("starts on the player's settings rather than an authored scenario's", () => {
    const state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: CUSTOM,
    });

    expect(state.scenarioId).toBe(CUSTOM_SCENARIO_ID);
    expect(state.customScenario).toEqual(CUSTOM);
    expect(state.startingYear).toBe(1990);
    expect(state.date.year).toBe(1990);
    expect(state.location.id).toBe("PIT");
    expect(state.feePerKgCO2e).toBe(50 / 1000);
    expect(state.dollarsPerkWh).toBe(0.1);
    // Within a rounding error of the starting cash: initGame pre-rolls a few frames, which
    // already earns and spends a little
    const cash = getTimeFromTimeline(state.date.minute, state.timeline)!.cash;
    expect(cash).toBeGreaterThan(499000000);
    expect(cash).toBeLessThan(501000000);
  });

  it("starts with the customer scale selected in custom setup", () => {
    const state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: { ...CUSTOM, startingCustomers: 250000 },
    });
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)!.customers,
    ).toBeCloseTo(250000, -4);
  });

  it("builds the starting facilities it was given", () => {
    const state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: CUSTOM,
    });

    // Specs that match nothing are skipped rather than built, which is how a starting portfolio
    // silently empties out - name and size have to line up with what the year can build
    expect(state.facilities.map((f: FacilityOperatingType) => f.name)).toEqual([
      "Coal",
      "Pumped Hydro",
    ]);
    expect(state.facilities[0].peakW).toBe(200000000);
    expect(state.facilities[1].peakWh).toBe(500000000);
    // Starting facilities are finished and free, unlike anything bought mid-game
    state.facilities.forEach((f: FacilityOperatingType) => {
      expect(f.yearsToBuildLeft).toBe(0);
      expect(f.loanAmountLeft).toBe(0);
    });
  });

  it("dispatches an offshore wind starting facility from offshore weather", () => {
    const state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: {
        ...CUSTOM,
        locationId: "SF",
        startingYear: 2020,
        facilities: [{ name: "Offshore Wind", peakW: 500000000 }],
      },
    });
    const offshore = state.facilities[0];
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;

    expect(offshore.name).toBe("Offshore Wind");
    expect(now.windOffshoreKph).toBeGreaterThan(0);
    expect(offshore.currentW).toBeGreaterThan(0);
    expect(offshore.currentW).toBeLessThanOrEqual(offshore.peakW);
  });

  it("runs a biomass starting facility with finite fuel costs and emissions", () => {
    const state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: {
        ...CUSTOM,
        startingYear: 2019,
        facilities: [{ name: "Biomass", peakW: 50000000 }],
      },
    });
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;

    expect(state.facilities[0]).toMatchObject({
      name: "Biomass",
      fuel: "Biomass",
      peakW: 50000000,
      yearsToBuildLeft: 0,
    });
    expect(now.supplyByFuel.Biomass).toBeGreaterThan(0);
    expect(now.expensesFuel).toBeGreaterThan(0);
    expect(now.kgco2e).toBeGreaterThan(0);
    expect(Number.isFinite(now.cash)).toBe(true);
    expect(Number.isFinite(now.expensesFuel)).toBe(true);
    expect(Number.isFinite(now.kgco2e)).toBe(true);
  });

  it("runs on the seed the player pinned, and replays identically from it", () => {
    const first = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: CUSTOM,
    });
    const second = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: CUSTOM,
    });

    expect(first.seed).toBe(1234);
    expect(second.seed).toBe(first.seed);
    expect(second.timeline[0].temperatureC).toBe(
      first.timeline[0].temperatureC,
    );
  });

  // Every custom game shares one id, so a finished one must not tick off a completion marker
  // (or, for the same reason, post a score to a leaderboard it has nothing in common with)
  it("isn't recorded as a scenario the player has completed", () => {
    localStorage.clear();

    // A one-month game so the run reaches its end, which is where completion is recorded
    runSimulation({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: { ...CUSTOM, durationMonths: 1 } as ScenarioType,
    });
    expect(getPlayedScenarioIds()).not.toContain(CUSTOM_SCENARIO_ID);

    // The same run of an authored scenario does get recorded, so the assertion above isn't
    // passing because nothing reaches the end
    runSimulation({ scenarioId: 4 }); // 104: Finances, also one month long
    expect(getPlayedScenarioIds()).toContain(4);
  });

  // The point of a scenario carrying a whole location rather than an id: a place the game has
  // never shipped can still be played, so nothing downstream may quietly re-resolve the id
  it("is played at the location it carries, not the one its id names", () => {
    const UNLISTED: LocationType = {
      // The id still picks the weather file, so this borrows one that exists; the rest of the
      // fields are what a location outside LOCATIONS would bring with it
      id: "SF",
      name: "Somewhere Not In LOCATIONS",
      lat: 12.3456,
      long: 65.4321,
      timeZone: "Etc/UTC",
      resources: { hydro: true },
    };
    const state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: { ...CUSTOM, locationId: "PIT", location: UNLISTED },
    });

    expect(state.location).toEqual(UNLISTED);
    expect(state.location.name).not.toBe(LOCATIONS.PIT.name);
    expect(state.location.lat).toBe(12.3456);
  });

  // The weather data ends in 2019 and is forecast forwards from there, and the fuel prices are
  // projected year by year, so a start decades past the record has to be simulated rather than
  // read. Nothing before 1980 is offered, because there is nothing to project backwards from.
  it("plays a start far past the end of the recorded data", () => {
    const result = runSimulation({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario: {
        ...CUSTOM,
        startingYear: 2080,
        durationMonths: 12 * 5,
        // Quoted in 2080 money, the way the custom game screen offers it. Fuel prices are the one
        // thing the game reads at face value for the year it is in, so a 2080 game charging a
        // literal ten cents a kilowatt hour against sixty years of escalated fuel is bankrupt in
        // its first quarter -- which is what this test caught when the escalation went in.
        dollarsPerkWh: 1.1,
        feePerKgCO2e: 530 / 1000,
        // Enough firm capacity that this weather-projection test is not cut short by the real
        // game's chronic-blackout firing rule, which the simulator also enforces.
        facilities: [{ name: "Natural Gas", peakW: 500000000 }],
      } as ScenarioType,
    });

    expect(result.months[0].year).toBe(2080);
    expect(result.months[result.months.length - 1].year).toBe(2084);
    expect(result.violationCount).toBe(0);
    // Weather that was forecast rather than the zeroed DUMMY_WEATHER a missing row returns,
    // which would flatten demand to the same number every month
    const demands = result.months.map((m: MonthlyHistoryType) => m.demandWh);
    expect(Math.min(...demands)).toBeGreaterThan(0);
    expect(new Set(demands).size).toBe(demands.length);
  });
});
