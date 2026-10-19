import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { GameType, ScenarioType, TickPresentFutureType } from "../Types";
import { TICK_MINUTES } from "../Constants";
import {
  activeScenario,
  activeScenarioOrDefault,
  currentCash,
  currentGenerationW,
  currentTick,
} from "./GameSelectors";

function tick(minute: number, cash: number): TickPresentFutureType {
  return { minute, cash } as TickPresentFutureType;
}

describe("currentTick and currentCash", () => {
  it("read the tick at the game's minute", () => {
    const game = {
      date: { minute: 1000 + TICK_MINUTES },
      timeline: [tick(1000, 5), tick(1000 + TICK_MINUTES, 7)],
    } as unknown as GameType;
    expect(currentTick(game)?.cash).toBe(7);
    expect(currentCash(game)).toBe(7);
  });

  it("fall back before a timeline exists", () => {
    const game = { date: { minute: 0 }, timeline: [] } as unknown as GameType;
    expect(currentTick(game)).toBeNull();
    expect(currentCash(game)).toBe(0);
  });
});

describe("activeScenario", () => {
  it("finds an authored scenario by ID", () => {
    expect(activeScenario({ scenarioId: SCENARIOS[1].id })).toBe(SCENARIOS[1]);
  });

  it("returns the custom scenario for the custom ID", () => {
    const custom = { id: CUSTOM_SCENARIO_ID } as ScenarioType;
    expect(
      activeScenario({
        scenarioId: CUSTOM_SCENARIO_ID,
        customScenario: custom,
      }),
    ).toBe(custom);
  });

  it("falls back to the first scenario only when asked", () => {
    expect(activeScenario({ scenarioId: -12345 })).toBeUndefined();
    expect(activeScenarioOrDefault({ scenarioId: -12345 })).toBe(SCENARIOS[0]);
  });
});

describe("currentGenerationW", () => {
  it("sums plant output and storage discharge, but not imports", () => {
    const game = {
      date: { minute: 1000 },
      timeline: [
        {
          minute: 1000,
          supplyByFuel: { Coal: 300, Wind: 200 },
          storageDischargeW: 50,
          importedW: 1000,
        },
      ],
    } as unknown as GameType;
    expect(currentGenerationW(game)).toBe(550);
  });

  it("is zero before a timeline exists", () => {
    const game = { date: { minute: 0 }, timeline: [] } as unknown as GameType;
    expect(currentGenerationW(game)).toBe(0);
  });
});
