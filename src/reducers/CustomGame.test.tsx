import { CUSTOM_SCENARIO_ID, DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { getPlayedScenarioIds } from "../LocalStorage";
import { createGame, runSimulation } from "../testing/Simulator";
import { FacilityOperatingType, ScenarioType } from "../Types";

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
});
