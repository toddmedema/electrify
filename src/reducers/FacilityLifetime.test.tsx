import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  generateNewTimeline,
  tickState,
  togglePauseFacility,
} from "./Game";
import {
  GAME_TO_REAL_YEARS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
} from "../Constants";
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
    starts: f.lifetimeStarts,
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
    const coal = state.facilities[0];
    coal.currentW = 0;
    coal.committed = false;
    coal.generatingLastRealTick = false;
    coal.annualOperatingCost = 0;
    coal.btuPerWh = 0;
    const before = state.facilities.map(totals);

    const now = getTimeFromTimeline(state.date.minute, state.timeline);
    // A year of simulation, which the Forecasts pane asks for on every month rollover
    const forecast = generateNewTimeline(
      state,
      now?.cash || 0,
      now?.customers || 0,
      TICKS_PER_DAY * 12,
    );

    expect(forecast[0].expensesOM).toBeCloseTo(
      (coal.costPerStart || 0) * GAME_TO_REAL_YEARS,
      6,
    );
    expect(state.facilities.map(totals)).toEqual(before);
    expect(coal.currentW).toBe(0);
    expect(coal.generatingLastRealTick).toBe(false);
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

  it("charges a start once to both Coal lifetime and company O&M", () => {
    const state = createGame({ scenarioId: 103, difficulty: "CEO" });
    // Let the opening tick build the month's forecast before forcing the real start under test.
    tickState(state);
    const coal = state.facilities.find(
      (facility: FacilityOperatingType) => facility.fuel === "Coal",
    ) as FacilityOperatingType;
    state.facilities.forEach((facility: FacilityOperatingType) => {
      facility.annualOperatingCost = 0;
      facility.btuPerWh = 0;
      facility.currentW = 0;
      facility.committed = false;
      facility.paused = facility.id !== coal.id;
    });
    coal.generatingLastRealTick = false;
    coal.lifetimeStarts = 0;
    const openingExpenses = coal.lifetimeExpenses;
    const expectedStartCost = (coal.costPerStart || 0) * GAME_TO_REAL_YEARS;

    tickState(state);

    expect(coal.currentW).toBeGreaterThan(0);
    expect(coal.lifetimeStarts).toBeCloseTo(GAME_TO_REAL_YEARS, 10);
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)?.expensesOM,
    ).toBeCloseTo(expectedStartCost, 6);
    expect(coal.lifetimeExpenses - openingExpenses).toBeCloseTo(
      expectedStartCost,
      6,
    );

    const afterStart = totals(coal);
    tickState(state);
    expect(totals(coal)).toMatchObject({
      expenses: afterStart.expenses,
      starts: afterStart.starts,
    });
  });

  it("charges Oil fixed and actual-output O&M once to both sets of books", () => {
    const state = createGame({ scenarioId: 101, difficulty: "CEO" });
    tickState(state);
    const oil = state.facilities.find(
      (facility: FacilityOperatingType) => facility.name === "Oil",
    )!;
    state.facilities.forEach((facility: FacilityOperatingType) => {
      facility.annualOperatingCost = 0;
      facility.variableOperatingCostPerMWh = undefined;
      facility.btuPerWh = 0;
      facility.currentW = 0;
      facility.paused = facility.id !== oil.id;
    });
    oil.annualOperatingCost = 3085368.560061;
    oil.variableOperatingCostPerMWh = 25.711404667176;
    const openingWh = oil.lifetimeWh;
    const openingExpenses = oil.lifetimeExpenses;

    tickState(state);

    const generatedWh = oil.lifetimeWh - openingWh;
    const expectedOM =
      oil.annualOperatingCost / TICKS_PER_YEAR +
      (generatedWh / 1000000) * oil.variableOperatingCostPerMWh;
    expect(generatedWh).toBeGreaterThan(0);
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)?.expensesOM,
    ).toBeCloseTo(expectedOM, 6);
    expect(oil.lifetimeExpenses - openingExpenses).toBeCloseTo(expectedOM, 6);
    expect(oil.lifetimeStarts).toBe(0);
  });

  it("charges an idle Oil plant fixed O&M but no variable O&M", () => {
    const state = createGame({ scenarioId: 101, difficulty: "CEO" });
    tickState(state);
    const oil = state.facilities.find(
      (facility: FacilityOperatingType) => facility.name === "Oil",
    )!;
    state.facilities.forEach((facility: FacilityOperatingType) => {
      facility.annualOperatingCost = 0;
      facility.variableOperatingCostPerMWh = undefined;
      facility.btuPerWh = 0;
      facility.currentW = 0;
      facility.paused = facility.id !== oil.id;
    });
    oil.annualOperatingCost = 3085368.560061;
    oil.variableOperatingCostPerMWh = 25.711404667176;
    oil.spinMinutes = Number.POSITIVE_INFINITY;
    const openingWh = oil.lifetimeWh;
    const openingExpenses = oil.lifetimeExpenses;

    tickState(state);

    const expectedFixedOM = oil.annualOperatingCost / TICKS_PER_YEAR;
    expect(oil.lifetimeWh).toBe(openingWh);
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)?.expensesOM,
    ).toBeCloseTo(expectedFixedOM, 6);
    expect(oil.lifetimeExpenses - openingExpenses).toBeCloseTo(
      expectedFixedOM,
      6,
    );
  });

  it("keeps paused Oil at half fixed O&M with no variable charge", () => {
    const state = createGame({ scenarioId: 101, difficulty: "CEO" });
    tickState(state);
    const oil = state.facilities.find(
      (facility: FacilityOperatingType) => facility.name === "Oil",
    )!;
    state.facilities.forEach((facility: FacilityOperatingType) => {
      facility.annualOperatingCost = 0;
      facility.variableOperatingCostPerMWh = undefined;
      facility.btuPerWh = 0;
      facility.paused = true;
    });
    oil.annualOperatingCost = 3085368.560061;
    oil.variableOperatingCostPerMWh = 25.711404667176;
    oil.currentW = oil.peakW;
    const openingWh = oil.lifetimeWh;
    const openingExpenses = oil.lifetimeExpenses;

    tickState(state);

    const expectedFixedOM = oil.annualOperatingCost / TICKS_PER_YEAR / 2;
    expect(oil.lifetimeWh).toBe(openingWh);
    expect(
      getTimeFromTimeline(state.date.minute, state.timeline)?.expensesOM,
    ).toBeCloseTo(expectedFixedOM, 6);
    expect(oil.lifetimeExpenses - openingExpenses).toBeCloseTo(
      expectedFixedOM,
      6,
    );
  });

  it("forecasts Oil variable O&M without mutating the live facility", () => {
    const state = play(createGame({ scenarioId: 101, difficulty: "CEO" }), 8);
    const oil = state.facilities.find(
      (facility: FacilityOperatingType) => facility.name === "Oil",
    )!;
    state.facilities.forEach((facility: FacilityOperatingType) => {
      facility.annualOperatingCost = 0;
      facility.variableOperatingCostPerMWh = undefined;
      facility.btuPerWh = 0;
    });
    oil.variableOperatingCostPerMWh = 25.711404667176;
    const before = cloneDeep(state.facilities);
    const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
    const forecast = generateNewTimeline(
      state,
      now.cash,
      now.customers,
      TICKS_PER_DAY,
    );
    const withoutVariable = cloneDeep(state);
    withoutVariable.facilities.find(
      (facility) => facility.id === oil.id,
    )!.variableOperatingCostPerMWh = undefined;
    const baseline = generateNewTimeline(
      withoutVariable,
      now.cash,
      now.customers,
      TICKS_PER_DAY,
    );
    const projectedVariableOM = forecast.reduce(
      (sum, tick, index) => sum + tick.expensesOM - baseline[index].expensesOM,
      0,
    );
    const expectedVariableOM = forecast.reduce(
      (sum, tick) =>
        sum +
        (((tick.supplyByFuel.Oil || 0) / TICKS_PER_HOUR) *
          GAME_TO_REAL_YEARS *
          oil.variableOperatingCostPerMWh!) /
          1000000,
      0,
    );

    expect(projectedVariableOM).toBeGreaterThan(0);
    expect(projectedVariableOM).toBeCloseTo(expectedVariableOM, 5);
    expect(state.facilities).toEqual(before);
  });

  it.each(["Nuclear", "Biomass", "Geothermal", "Enhanced Geothermal"])(
    "tracks a zero-cost %s start without adding an expense",
    (name) => {
      const state = createGame({ scenarioId: 103 });
      tickState(state);
      const coal = state.facilities[0];
      state.facilities.forEach((facility: FacilityOperatingType) => {
        facility.annualOperatingCost = 0;
        facility.btuPerWh = 0;
        facility.currentW = 0;
        facility.committed = false;
        facility.paused = facility.id !== coal.id;
      });
      coal.name = name;
      coal.tracksStarts = true;
      coal.costPerStart = undefined;
      coal.generatingLastRealTick = false;
      coal.lifetimeStarts = 0;
      const openingExpenses = coal.lifetimeExpenses;

      tickState(state);

      expect(coal.currentW).toBeGreaterThan(0);
      expect(coal.lifetimeStarts).toBeCloseTo(GAME_TO_REAL_YEARS, 10);
      expect(coal.lifetimeExpenses).toBe(openingExpenses);
      expect(
        getTimeFromTimeline(state.date.minute, state.timeline)?.expensesOM,
      ).toBe(0);
    },
  );
});
