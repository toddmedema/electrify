import cloneDeep from "lodash.clonedeep";
import gameReducer, { reprioritizeFacility, tickState } from "./Game";
import { createGame } from "../testing/Simulator";

describe("reprioritizeFacility", () => {
  it("reorders after recorded ticks have entered the forecast timeline", () => {
    let state = createGame({ scenarioId: 106 });
    tickState(state);
    state = cloneDeep(state);
    const before = state.facilities.map((facility) => facility.id);

    const after = gameReducer(
      state,
      reprioritizeFacility({ spotInList: 0, delta: 1 }),
    );

    expect(after.facilities.map((facility) => facility.id)).toEqual([
      before[1],
      before[0],
    ]);
  });
});
