import { CHERNOBYL_SCENARIO, CHERNOBYL_SCENARIO_ID } from "./ChernobylScenario";
import { resolveStoryAtDate, upcomingStoryPhases } from "./WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { officialScenarioRules } from "../helpers/ScenarioRules";
import type { DifficultyType, StorySnapshotType } from "../Types";

const snapshot: StorySnapshotType = {
  deliveredWhByFuel12m: {},
  demandWh12m: 0,
  unservedWh12m: 0,
  netIncome12m: 0,
  peakDemandW12m: 0,
  firmPeakW: 0,
  storagePeakW: 0,
  storagePeakWh: 0,
  facilities: [1, 2, 3, 4, 5].map((id) => ({
    id,
    name: id === 5 ? "Replacement reactor" : `Chernobyl Unit ${id}`,
    ...(id !== 5 ? { startingAssetId: `chernobyl-unit-${id}` } : {}),
    fuel: "Uranium",
    peakW: 100000000,
    ageYears: 3,
    // Even pausing an original unit before April cannot evade its shutdown.
    operational: id !== 2,
  })),
};

function context(
  month: number,
  difficulty: DifficultyType = "Manager",
  seed = 77,
) {
  return {
    scenarioId: CHERNOBYL_SCENARIO_ID,
    seed,
    difficulty,
    rules: officialScenarioRules(CHERNOBYL_SCENARIO, { difficulty, seed }),
    date: getDateFromMinute(month * MINUTES_PER_MONTH, 1986),
    location: CHERNOBYL_SCENARIO.location!,
    snapshot,
  };
}

describe("Chernobyl's historical recovery", () => {
  it("gives one month before the scheduled disaster without an extra preparation period", () => {
    const march = context(2);
    expect(resolveStoryAtDate(march).effects).toEqual({});
    expect(upcomingStoryPhases(march)[0]).toMatchObject({
      startsMinute: 3 * MINUTES_PER_MONTH,
    });
  });

  it.each([
    [3, [1, 2, 3, 4]], // April 1986
    [8, [1, 2, 3, 4]], // September 1986
    [9, [2, 3, 4]], // October 1986
    [10, [3, 4]], // November 1986
    [22, [3, 4]], // November 1987
    [23, [4]], // December 1987
    [61, [4]], // February 1991: Unit 4 never returns
  ])("month %i shuts down exactly the original units %j", (month, units) => {
    const result = resolveStoryAtDate(context(month));
    expect(result.effects.facilityOutputMultipliersById).toEqual(
      Object.fromEntries(units.map((unit) => [String(unit), 0])),
    );
    // Cleanup belongs to the inherited reactor, never a second company-level charge.
    expect(result.effects.operatingExpensePerMonth).toBeUndefined();
    // A newly constructed nuclear plant is not part of the damaged site.
    expect(result.effects.facilityOutputMultipliersById?.[5]).toBeUndefined();
  });

  it("keeps accident and restart dates fixed across seeds and difficulties", () => {
    const expected = [3, 9, 10, 23];
    for (const difficulty of [
      "Intern",
      "Employee",
      "Manager",
      "VP",
      "CEO",
    ] as const) {
      for (const seed of [1, 77, 12345]) {
        expect(
          context(2, difficulty, seed)
            .rules?.events.map((event) => event.startMonth)
            .sort((a, b) => a - b),
        ).toEqual(expected);
      }
    }
  });
});
