import cloneDeep from "lodash.clonedeep";
import gameReducer, {
  buildFacility,
  generateNewTimeline,
  tickState,
} from "./Game";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { validBuildFacility } from "../helpers/BuildValidation";
import { facilityCashBack } from "../helpers/Financials";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { GameType, GeneratorShoppingType } from "../Types";
import { createGame } from "../testing/Simulator";
import { LOCATIONS, TICKS_PER_MONTH } from "../Constants";

function aGeneratorToBuild(state: GameType): GeneratorShoppingType {
  const generator = GENERATORS(state, 500000000, [20], [500]).find(
    (g: GeneratorShoppingType) => g.available && g.fuel === "Natural Gas",
  );
  if (!generator) {
    throw new Error("No natural gas generator available to build");
  }
  return generator;
}

// The part of the timeline that is still a forecast rather than recorded history
function futureTicks(state: GameType) {
  return state.timeline.filter((t) => t.minute > state.date.minute);
}

describe("buildFacility", () => {
  it("accepts all authored generator and storage shopping models", () => {
    const state = createGame({ scenarioId: 103 });
    state.date.year = 2035;
    state.location = { ...LOCATIONS.SF, offshore: true };
    const quotes = [
      ...GENERATORS(state, 50000000, [20], [500]),
      ...STORAGE(state, 50000000),
    ];
    expect(quotes.length).toBeGreaterThan(10);
    for (const facility of quotes) {
      expect({
        name: facility.name,
        valid: validBuildFacility({ facility, financed: true }),
      }).toEqual({ name: facility.name, valid: true });
    }
  });

  it.each([false, true])(
    "preserves project equity during construction (financed: %s)",
    (financed) => {
      const before = createGame({ scenarioId: 103 });
      const generator = { ...aGeneratorToBuild(before), buildCost: 1000000 };
      const initial = getTimeFromTimeline(before.date.minute, before.timeline)!;
      const after = cloneDeep(
        gameReducer(before, buildFacility({ facility: generator, financed })),
      );
      const purchased = getTimeFromTimeline(after.date.minute, after.timeline)!;
      expect(purchased.netWorth).toBeCloseTo(initial.netWorth, 4);
      const built = after.facilities.find((f) => f.name === generator.name)!;
      // A persisted project may already have repaid principal; equity follows its actual debt.
      if (financed) {
        built.loanAmountLeft -= 100000;
        purchased.cash -= 100000;
      }
      for (let i = 0; i < 4; i++) tickState(after);
      const now = getTimeFromTimeline(after.date.minute, after.timeline)!;
      expect(built.yearsToBuildLeft).toBeGreaterThan(0);
      expect(now.netWorth).toBeCloseTo(
        now.cash +
          after.facilities.reduce(
            (value, facility) => value + facilityCashBack(facility, now.minute),
            0,
          ),
        4,
      );
    },
  );

  it("ignores malformed build payloads before charging cash or recording an action", () => {
    const before = createGame({ scenarioId: 103 });
    const after = gameReducer(
      before,
      buildFacility({ facility: {} as GeneratorShoppingType, financed: false }),
    );
    expect(after).toEqual(before);
  });
  it("adds the facility and charges the down payment", () => {
    const before = createGame({ scenarioId: 103 });
    const generator = aGeneratorToBuild(before);
    const cashBefore = getTimeFromTimeline(
      before.date.minute,
      before.timeline,
    )!.cash;

    const after = gameReducer(
      before,
      buildFacility({ facility: generator, financed: true }),
    );

    expect(after.facilities.length).toBe(before.facilities.length + 1);
    const built = after.facilities.find((f) => f.name === generator.name);
    expect(built).toBeDefined();
    expect(built!.yearsToBuildLeft).toBeGreaterThan(0);
    expect(built!.loanAmountLeft).toBeGreaterThan(0);
    expect(
      getTimeFromTimeline(after.date.minute, after.timeline)!.cash,
    ).toBeLessThan(cashBefore);
  });

  /**
   * Regression test. This reducer used to spread the reforecast into a new object and assign it to
   * its own parameter, which immer discards, so the forecast silently kept describing the old
   * fleet until the next month rollover regenerated the timeline.
   */
  it("reforecasts the timeline so the projection includes the new facility", () => {
    const before = createGame({ scenarioId: 103 });
    // Nothing is financed at the start of a scenario, so any interest in the forecast is new
    expect(futureTicks(before).every((t) => t.expensesInterest === 0)).toBe(
      true,
    );

    const after = gameReducer(
      before,
      buildFacility({ facility: aGeneratorToBuild(before), financed: true }),
    );

    expect(futureTicks(after).length).toBeGreaterThan(0);
    expect(futureTicks(after).every((t) => t.expensesInterest > 0)).toBe(true);
  });

  it("rejects a stale purchase after the last viable site has been claimed", () => {
    let state = createGame({ scenarioId: 103 });
    const hydro = GENERATORS(state, 50000000, [20], [500]).find(
      (g: GeneratorShoppingType) => g.name === "Hydro",
    );
    expect(hydro?.viableLocationsRemaining).toBe(3);

    for (let attempt = 0; attempt < 4; attempt++) {
      state = gameReducer(
        state,
        buildFacility({ facility: hydro!, financed: true }),
      );
    }

    expect(
      state.facilities.filter((facility) => facility.name === "Hydro"),
    ).toHaveLength(3);
    state.facilities.forEach((facility) => {
      expect(facility).not.toHaveProperty("viableLocationsRemaining");
    });
  });

  it("rejects a stale purchase when current cash no longer covers it", () => {
    const before = createGame({ scenarioId: 103 });
    const generator = aGeneratorToBuild(before);
    getTimeFromTimeline(before.date.minute, before.timeline)!.cash = 0;

    const after = gameReducer(
      before,
      buildFacility({ facility: generator, financed: true }),
    );

    expect(after.facilities).toHaveLength(before.facilities.length);
  });

  it("keeps a long cash forecast finite when hydro finishes construction", () => {
    const before = createGame({ scenarioId: 103 });
    const hydro = GENERATORS(before, 50000000, [20], [500]).find(
      (g: GeneratorShoppingType) => g.name === "Hydro",
    );
    expect(hydro).toBeDefined();

    const after = gameReducer(
      before,
      buildFacility({ facility: hydro!, financed: true }),
    );
    const now = getTimeFromTimeline(after.date.minute, after.timeline)!;
    const forecast = generateNewTimeline(
      after,
      now.cash,
      now.customers,
      TICKS_PER_MONTH * 24,
    );

    // Hydro finishes inside this horizon. It has an emissions entry but no purchased-fuel price;
    // that combination used to turn its first fuel expense, and then the Cash chart, into NaN.
    expect(
      after.facilities.find((f) => f.name === "Hydro")!.yearsToBuildLeft,
    ).toBeGreaterThan(0);
    expect(forecast.every((tick) => Number.isFinite(tick.cash))).toBe(true);
    expect(forecast.every((tick) => Number.isFinite(tick.expensesFuel))).toBe(
      true,
    );
  });
});
