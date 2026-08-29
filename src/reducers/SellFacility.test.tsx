import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_DAY } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { facilityCashBack } from "../helpers/Financials";
import { createGame } from "../testing/Simulator";
import {
  FacilityOperatingType,
  GameType,
  GeneratorShoppingType,
} from "../Types";
import gameReducer, { buildFacility, sellFacility, tickState } from "./Game";

function playTicks(state: GameType, ticks: number): GameType {
  const played = cloneDeep(state);
  for (let i = 0; i < ticks; i++) {
    tickState(played);
  }
  return played;
}

function cashNow(state: GameType): number {
  return getTimeFromTimeline(state.date.minute, state.timeline)!.cash;
}

describe("sellFacility cash transactions", () => {
  it("credits a completed facility sale after the month is underway", () => {
    const before = playTicks(
      createGame({ scenarioId: 103 }),
      TICKS_PER_DAY / 2,
    );
    const sold = before.facilities.find(
      (facility: FacilityOperatingType) => facility.yearsToBuildLeft === 0,
    )!;
    const cashBefore = cashNow(before);
    const expectedProceeds = facilityCashBack(sold, before.date.minute);

    const after = gameReducer(before, sellFacility(sold.id));

    expect(cashNow(after)).toBeCloseTo(cashBefore + expectedProceeds, 6);
    expect(after.facilities.some((facility) => facility.id === sold.id)).toBe(
      false,
    );
  });

  it("returns committed equity when construction is cancelled", () => {
    const before = playTicks(
      createGame({ scenarioId: 103 }),
      TICKS_PER_DAY / 2,
    );
    const generator = GENERATORS(before, 500000000, [20], [500]).find(
      (facility: GeneratorShoppingType) => facility.fuel === "Natural Gas",
    )!;
    const built = gameReducer(
      before,
      buildFacility({ facility: generator, financed: true }),
    );
    const underConstruction = built.facilities.find(
      (facility) => facility.yearsToBuildLeft > 0,
    )!;
    const cashAfterBuild = cashNow(built);
    const expectedRefund = facilityCashBack(
      underConstruction,
      built.date.minute,
    );

    const after = gameReducer(built, sellFacility(underConstruction.id));

    expect(cashNow(after)).toBeCloseTo(cashAfterBuild + expectedRefund, 6);
    expect(
      after.facilities.some((facility) => facility.id === underConstruction.id),
    ).toBe(false);
  });
});
