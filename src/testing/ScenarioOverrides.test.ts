import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { withScenarioOverrides } from "./ScenarioOverrides";
import { createGame } from "./Simulator";

const shale = SCENARIOS.find((scenario) => scenario.id === 103)!;
const recent = SCENARIOS.find((scenario) => scenario.startingYear === 2024)!;

function money(scenario: ScenarioType) {
  return [scenario.cash, scenario.dollarsPerkWh, scenario.feePerKgCO2e];
}

describe("simulation scenario overrides", () => {
  it("leaves the authored scenario selected when there are no overrides", () => {
    expect(withScenarioOverrides(shale, {})).toBeUndefined();
  });

  it.each(SCENARIOS)(
    "preserves $name money when its year is unchanged",
    (scenario) => {
      expect(
        money(
          withScenarioOverrides(scenario, { year: scenario.startingYear })!,
        ),
      ).toEqual(money(scenario));
    },
  );

  it("does not round or deflate money between historical years", () => {
    const scenario = { ...shale, cash: 275123456, dollarsPerkWh: 0.025 };
    expect(money(withScenarioOverrides(scenario, { year: 1990 })!)).toEqual(
      money(scenario),
    );
  });

  it("re-quotes historical cash, rates and fees for a future start", () => {
    const scenario = { ...shale, feePerKgCO2e: 0.05 };
    const shifted = withScenarioOverrides(scenario, { year: 2080 })!;
    expect(money(shifted)).toEqual([2300000000, 0.32, 0.53]);
    expect(shifted.id).toBe(CUSTOM_SCENARIO_ID);
    expect(scenario.cash).toBe(220000000);
  });

  it("converts from a recent scenario's own era, not from 2020 again", () => {
    expect(money(withScenarioOverrides(recent, { year: 2025 })!)).toEqual([
      190000000, 0.25, 0.052,
    ]);
  });

  it("removes projected escalation when moving back to a historical year", () => {
    const future = {
      ...shale,
      startingYear: 2080,
      cash: 2300000000,
      dollarsPerkWh: 0.32,
    };
    expect(money(withScenarioOverrides(future, { year: 2000 })!)).toEqual([
      220000000, 0.03, 0,
    ]);
  });

  it("changes location without changing money or the original scenario", () => {
    const shifted = withScenarioOverrides(recent, { locationId: "PIT" })!;
    expect(money(shifted)).toEqual(money(recent));
    expect(shifted.locationId).toBe("PIT");
    expect(shifted.location?.id).toBe("PIT");
    expect(shifted.startingYear).toBe(recent.startingYear);
    expect(shifted.id).toBe(CUSTOM_SCENARIO_ID);
  });

  it("rejects an unknown location", () => {
    expect(() =>
      withScenarioOverrides(shale, { locationId: "no-such-city" }),
    ).toThrow('Unknown location "no-such-city"');
  });

  it("keeps the market benchmark in the new era with an explicit player rate", () => {
    const scenario = withScenarioOverrides(shale, { year: 2080 })!;
    const game = createGame({
      scenarioId: shale.id,
      scenario,
      dollarsPerkWh: 0.05,
    });
    expect(game.startingYear).toBe(2080);
    expect(game.dollarsPerkWh).toBe(0.05);
    expect(game.customScenario?.dollarsPerkWh).toBe(0.32);
  });
});
