import cloneDeep from "lodash.clonedeep";
import { PayloadAction } from "@reduxjs/toolkit";
import gameReducer, { togglePauseFacility, tickState } from "./Game";
import { TICK_MINUTES } from "../Constants";
import { createGame } from "../testing/Simulator";
import { FacilityOperatingType, GameType } from "../Types";

// Redux Toolkit freezes reducer output in development, and tickState mutates state in place
function dispatch(state: GameType, action: PayloadAction<number>): GameType {
  return cloneDeep(gameReducer(state, action));
}

// Everything about a facility that only the passage of time is supposed to change
function liveState(state: GameType) {
  return state.facilities.map((f: FacilityOperatingType) => ({
    id: f.id,
    currentW: f.currentW,
    currentWh: f.currentWh,
    yearsToBuildLeft: f.yearsToBuildLeft,
    loanAmountLeft: f.loanAmountLeft,
  }));
}

describe("togglePauseFacility", () => {
  it("pauses and resumes the facility", () => {
    const before = createGame({ scenarioId: 103 });
    const id = before.facilities[0].id;
    expect(before.facilities[0].paused).toBeFalsy();

    const paused = dispatch(before, togglePauseFacility(id));
    expect(paused.facilities[0].paused).toBe(true);

    const resumed = dispatch(paused, togglePauseFacility(id));
    expect(resumed.facilities[0].paused).toBe(false);
  });

  /**
   * Regression test for #117. reforecastSupply used to shallow copy the state, so the forecast ran
   * updateSupplyFacilitiesFinances against the real facility objects and left them wherever the
   * end of the forecast horizon put them -- ramped up, charged, a day further into construction
   * and a day further through their loan.
   */
  it("does not move the live fleet forward while reforecasting", () => {
    const before = createGame({ scenarioId: 103 });
    const snapshot = liveState(before);

    const after = dispatch(
      before,
      togglePauseFacility(before.facilities[0].id),
    );

    expect(liveState(after)).toEqual(snapshot);
  });

  it("ramps back up over time rather than snapping to full output", () => {
    let state = createGame({ scenarioId: 103 });
    const id = state.facilities[0].id;
    const { peakW, spinMinutes } = state.facilities[0];
    const rampPerTick = (peakW * TICK_MINUTES) / spinMinutes;

    // Pause and let it wind all the way down
    state = dispatch(state, togglePauseFacility(id));
    for (let i = 0; i < Math.ceil(spinMinutes / TICK_MINUTES); i++) {
      tickState(state);
    }
    expect(state.facilities[0].currentW).toBe(0);

    // Resuming reforecasts, which must not touch the facility's current output
    state = dispatch(state, togglePauseFacility(id));
    expect(state.facilities[0].currentW).toBe(0);

    // ... and the first tick back may only spin it up by one tick's worth of ramp
    tickState(state);
    expect(state.facilities[0].currentW).toBeGreaterThan(0);
    expect(state.facilities[0].currentW).toBeCloseTo(rampPerTick, 5);
  });
});
