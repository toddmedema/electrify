import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  generateNewTimeline,
  tickState,
  togglePauseFacility,
} from "./Game";
import { TICKS_PER_DAY, TICKS_PER_MONTH } from "../Constants";
import { facilityLifetime } from "../helpers/Financials";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import { FacilityOperatingType, GameType } from "../Types";

/**
 * The running totals each facility keeps about itself, which is what lets the fleet list report
 * a capacity factor and a lifetime profit per row rather than only a nameplate.
 *
 * The thing worth guarding here isn't the arithmetic, it's what counts as a tick of a facility's
 * life: forecasts run the same simulation code against a clone of the fleet, dozens of times a
 * second and up to twenty years at a time, and none of that ever happened.
 */

function play(state: GameType, ticks: number): GameType {
  for (let i = 0; i < ticks; i++) {
    tickState(state);
  }
  return state;
}

function totals(f: FacilityOperatingType) {
  return {
    wh: f.lifetimeWh,
    potentialWh: f.lifetimePotentialWh,
    revenue: f.lifetimeRevenue,
    expenses: f.lifetimeExpenses,
  };
}

describe("per-facility lifetime totals", () => {
  it("starts a facility with nothing on its record", () => {
    const state = createGame({ scenarioId: 103 });
    state.facilities.forEach((f: FacilityOperatingType) => {
      const lifetime = facilityLifetime(f);
      expect(lifetime.wh).toBe(0);
      expect(lifetime.profit).toBe(0);
      // Nothing delivered means no cost per MWh to quote, rather than a division by zero
      expect(lifetime.costPerMWh).toBeUndefined();
      expect(lifetime.capacityFactor).toBeUndefined();
    });
  });

  it("accrues output, revenue and costs as the game ticks", () => {
    const state = play(createGame({ scenarioId: 103 }), TICKS_PER_DAY);
    const generator = state.facilities.find(
      (f: FacilityOperatingType) => f.fuel,
    ) as FacilityOperatingType;

    const lifetime = facilityLifetime(generator);
    expect(lifetime.wh).toBeGreaterThan(0);
    expect(lifetime.revenue).toBeGreaterThan(0);
    expect(lifetime.expenses).toBeGreaterThan(0);
    expect(lifetime.profit).toBeCloseTo(
      lifetime.revenue - lifetime.expenses,
      6,
    );
    // A capacity factor is a fraction of flat-out, so it can reach 1 but never pass it
    expect(lifetime.capacityFactor).toBeGreaterThan(0);
    expect(lifetime.capacityFactor).toBeLessThanOrEqual(1);
  });

  it("never books more than one company's revenue across the fleet", () => {
    const booked = (state: GameType) =>
      state.facilities.reduce(
        (sum: number, f: FacilityOperatingType) => sum + f.lifetimeRevenue,
        0,
      );

    const state = createGame({ scenarioId: 103 });
    // The first tick of a fresh game rolls the month over, which replaces the timeline with a
    // new forecast -- so the tick that was just played is no longer on the record to compare
    // against. Start measuring from the one after it, and stop short of the next rollover
    tickState(state);
    const opening = booked(state);

    let earned = 0;
    for (let i = 0; i < TICKS_PER_MONTH - 3; i++) {
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline);
      earned += now ? now.revenue : 0;
    }

    // Each facility takes its share of what was actually sold, so the shares add back up to
    // it -- relatively, since a month of accumulated floats won't land on a sum taken in a
    // different order to the last cent
    expect(earned).toBeGreaterThan(0);
    expect((booked(state) - opening) / earned).toBeCloseTo(1, 9);
  });

  it("does not count a forecast as time the fleet lived through", () => {
    const state = play(createGame({ scenarioId: 103 }), 8);
    const before = state.facilities.map(totals);

    const now = getTimeFromTimeline(state.date.minute, state.timeline);
    // A year of simulation, which the Forecasts pane asks for on every month rollover
    generateNewTimeline(
      state,
      now?.cash || 0,
      now?.customers || 0,
      TICKS_PER_DAY * 12,
    );

    expect(state.facilities.map(totals)).toEqual(before);
  });

  it("does not count the reforecast a player action triggers", () => {
    const played = play(createGame({ scenarioId: 103 }), 8);
    const before = played.facilities.map(totals);

    // Pausing a plant reforecasts the whole timeline against the fleet it leaves behind
    const after = cloneDeep(
      gameReducer(played, togglePauseFacility(played.facilities[0].id)),
    );

    expect(after.facilities.map(totals)).toEqual(before);
  });
});
