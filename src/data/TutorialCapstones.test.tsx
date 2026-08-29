import { getStore } from "../StoreRegistry";
import { AppStateType, GameType, ScenarioType } from "../Types";
import gameReducer, {
  delta,
  initGame,
  start,
  tickState,
} from "../reducers/Game";
import { createGame } from "../testing/Simulator";
import { TUTORIALS } from "./Scenarios";

function tutorial(id: number): ScenarioType {
  return TUTORIALS.find((scenario) => scenario.id === id) as ScenarioType;
}

function capstone(id: number) {
  return tutorial(id).tutorialSteps!.find((step) => step.capstone)!.capstone!;
}

function appState(game: GameType): AppStateType {
  return { ...getStore().getState(), game };
}

function tickUntil(
  game: GameType,
  predicate: (state: AppStateType) => boolean,
  maxTicks = 2000,
): boolean {
  for (let i = 0; i < maxTicks; i++) {
    tickState(game);
    if (predicate(appState(game))) {
      return true;
    }
  }
  return false;
}

describe("authored tutorial capstones", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("cycles storage through charge and discharge before Mission 3's deadline", () => {
    const scenario = {
      ...tutorial(2),
      id: 9998,
      facilities: capstone(2).checkpoint!.facilities!,
    };
    const game = createGame({ scenarioId: scenario.id, scenario });
    const objective = capstone(2);

    expect(tickUntil(game, objective.success, 192)).toBe(true);
    expect(objective.failure?.(appState(game))).toBe(false);
    const storage = game.facilities.find(
      (facility) => "currentWh" in facility,
    )!;
    expect(storage.lifetimeWh).toBeGreaterThan(0);
  });

  it("starts Mission 4's capstone from its authored loss-making checkpoint", () => {
    const scenario = tutorial(4);
    const capstoneIndex = scenario.tutorialSteps!.findIndex(
      (step) => step.capstone,
    );
    // createGame loads the scenario's weather/economy fixtures used by initGame below.
    const baseline = createGame({ scenarioId: scenario.id });
    let game = gameReducer(undefined, start(scenario.id));
    game = gameReducer(game, delta({ tutorialStep: capstoneIndex }));
    game = gameReducer(
      game,
      initGame({
        facilities: scenario.facilities,
        cash: scenario.cash,
        customers: baseline.customerMarketSize / 2,
        location: baseline.location,
        seed: scenario.seed,
      }),
    );

    expect(game.dollarsPerkWh).toBe(0.03);
    expect(game.customerRate).toBe(0.03);
    expect(game.seed).toBe(249004);
    expect(game.eventLog).toEqual([]);
    expect(game.tutorialStep).toBe(capstoneIndex);
  });

  it("accepts a sustainable Mission 4 rate and rejects the checkpoint rate", () => {
    const objective = capstone(4);
    const scenario = {
      ...tutorial(4),
      id: 9999,
      durationMonths: 2,
    };
    const sustainable = createGame({
      scenarioId: scenario.id,
      scenario,
      dollarsPerkWh: 0.06,
    });
    const lossMaking = createGame({
      scenarioId: scenario.id,
      scenario,
      dollarsPerkWh: 0.03,
    });

    expect(tickUntil(sustainable, objective.success, 120)).toBe(true);
    expect(tickUntil(lossMaking, objective.failure!, 120)).toBe(true);
    expect(objective.success(appState(lossMaking))).toBe(false);
  });

  it("rewards profitable customer growth and rejects an unsustainable discount", () => {
    const objective = capstone(3);
    const balanced = createGame({ scenarioId: 3, dollarsPerkWh: 0.06 });
    const tooCheap = createGame({ scenarioId: 3, dollarsPerkWh: 0.03 });

    expect(tickUntil(balanced, objective.success, 700)).toBe(true);
    expect(tickUntil(tooCheap, objective.failure!, 700)).toBe(true);
    expect(objective.success(appState(tooCheap))).toBe(false);
  });

  it("lets timely capacity prevent Mission 6's forecast shortage", () => {
    const objective = capstone(5);
    const prepared = createGame({
      scenarioId: 5,
      initialBuild: { name: "Oil", peakW: 100000000, financed: false },
    });
    const unprepared = createGame({ scenarioId: 5 });

    expect(tickUntil(prepared, objective.success, 800)).toBe(true);
    expect(objective.failure?.(appState(prepared))).toBe(false);
    expect(tickUntil(unprepared, objective.failure!, 800)).toBe(true);
    expect(objective.success(appState(unprepared))).toBe(false);
  });
});
