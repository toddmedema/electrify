import { TICK_MINUTES } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import { GeneratorOperatingType, GameType } from "../Types";
import { tickState } from "./Game";

function isolatedOnlineCoal(): {
  state: GameType;
  coal: GeneratorOperatingType;
  nextIndex: number;
} {
  const state = createGame({ scenarioId: 103, difficulty: "CEO" });
  tickState(state);
  const coal = state.facilities.find(
    (facility) => facility.name === "Coal",
  ) as GeneratorOperatingType;
  state.facilities = [coal];
  coal.currentW = coal.peakW * (coal.minimumStableOutput || 0);
  coal.committed = true;
  coal.generatingLastRealTick = true;

  const nextMinute = state.date.minute + TICK_MINUTES;
  const nextIndex = state.timeline.findIndex(
    (tick) => tick.minute === nextMinute,
  );
  for (let i = nextIndex; i < state.timeline.length; i++) {
    state.timeline[i].demandW = 0;
    state.timeline[i].dispatchTargetWByFacility = { [coal.id]: 0 };
  }
  return { state, coal, nextIndex };
}

describe("minimum stable generator dispatch", () => {
  it("holds an online plant at its minimum when avoiding the next start is cheaper", () => {
    const { state, coal, nextIndex } = isolatedOnlineCoal();
    coal.costPerStart = 1000000000;
    state.timeline[nextIndex + 2].dispatchTargetWByFacility[coal.id] = 1;

    tickState(state);

    expect(coal.committed).toBe(true);
    expect(coal.currentW).toBeCloseTo(
      coal.peakW * (coal.minimumStableOutput || 0),
      5,
    );
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)?.supplyW,
    ).toBeCloseTo(coal.currentW, 5);
  });

  it("begins shutting down when minimum-load cost exceeds the avoided start", () => {
    const { state, coal, nextIndex } = isolatedOnlineCoal();
    coal.costPerStart = 1;
    coal.variableOperatingCostPerMWh = 1000000000;
    state.timeline[nextIndex + 3].dispatchTargetWByFacility[coal.id] = 1;
    const minimumW = coal.currentW;

    tickState(state);

    expect(coal.committed).toBe(false);
    expect(coal.currentW).toBeLessThan(minimumW);
    // Sub-minimum output is allowed only as the transient shutdown ramp continues toward zero.
    expect(coal.currentW).toBeGreaterThan(0);
  });
});
