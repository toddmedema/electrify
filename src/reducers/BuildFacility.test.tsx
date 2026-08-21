import gameReducer, { buildFacility } from "./Game";
import { GENERATORS } from "../data/Facilities";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { GameType, GeneratorShoppingType } from "../Types";
import { createGame } from "../testing/Simulator";

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

  it("leaves the recorded past alone", () => {
    const before = createGame({ scenarioId: 103 });
    const pastBefore = before.timeline
      .filter((t) => t.minute < before.date.minute)
      .map((t) => t.cash);

    const after = gameReducer(
      before,
      buildFacility({ facility: aGeneratorToBuild(before), financed: true }),
    );

    expect(
      after.timeline
        .filter((t) => t.minute < after.date.minute)
        .map((t) => t.cash),
    ).toEqual(pastBefore);
  });
});
