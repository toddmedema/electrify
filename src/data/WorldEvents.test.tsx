import { LOCATIONS } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { StorySnapshotType } from "../Types";
import {
  combineStoryEffects,
  resolveStoryAtDate,
  resolveStoryScheduleMonth,
  SHALE_BOOM_BALANCE,
  STORY_ARC_DEFINITIONS,
  StoryArcDefinitionType,
  storyPhaseKey,
  upcomingStoryPhases,
} from "./WorldEvents";
import { DifficultyType } from "../Types";

const EMPTY_SNAPSHOT: StorySnapshotType = {
  deliveredWhByFuel12m: {},
  demandWh12m: 0,
  unservedWh12m: 0,
  netIncome12m: 0,
  peakDemandW12m: 0,
  firmPeakW: 0,
  storagePeakW: 0,
  storagePeakWh: 0,
  facilities: [],
};

const definition: StoryArcDefinitionType = {
  id: "test-arc",
  scenarioId: 103,
  phases: [
    {
      id: "warning",
      schedule: { atMonth: 2 },
      describe: () => ({ kind: "FUEL_PRICE", message: "Warning" }),
    },
    {
      id: "onset",
      schedule: {
        seededMonthRange: { firstMonth: 4, lastMonth: 8 },
        randomKey: "onset-month",
      },
      durationMonths: 3,
      describe: (_context, random) => {
        const size = Math.round(10 + random("size") * 90);
        return {
          kind: "FUEL_PRICE",
          message: `Change ${size}`,
          attributes: { size },
          effects: {
            demandMultiplier: 1.1,
            fuelPriceMultipliers: { "Natural Gas": 0.75 },
          },
        };
      },
    },
  ],
};

function context(month: number, scenarioId = 103, seed = 12345) {
  return {
    seed,
    scenarioId,
    difficulty: "Manager" as const,
    date: getDateFromMinute(month * MINUTES_PER_MONTH, 2006),
    location: LOCATIONS.PIT,
    snapshot: EMPTY_SNAPSHOT,
  };
}

describe("deterministic story schedules", () => {
  it("resolves fixed months relative to the scenario start", () => {
    const result = resolveStoryAtDate(context(2), [definition]);
    expect(result.occurrences.map((event) => event.key)).toEqual([
      "story:103:test-arc:warning",
    ]);
  });

  it("keeps seeded timing and attributes stable for a seed", () => {
    const key = storyPhaseKey(103, "test-arc", "onset");
    const month = resolveStoryScheduleMonth(
      definition.phases[1].schedule,
      12345,
      key,
    );
    const first = resolveStoryAtDate(context(month), [definition]);
    const second = resolveStoryAtDate(context(month), [definition]);
    expect(first).toEqual(second);
    expect(month).toBeGreaterThanOrEqual(4);
    expect(month).toBeLessThanOrEqual(8);
  });

  it("varies a seeded schedule across a seed sample", () => {
    const key = storyPhaseKey(103, "test-arc", "onset");
    const months = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        resolveStoryScheduleMonth(definition.phases[1].schedule, seed + 1, key),
      ),
    );
    expect(months.size).toBeGreaterThan(1);
  });

  it("is independent of definition order", () => {
    const other: StoryArcDefinitionType = {
      id: "unrelated",
      scenarioId: 103,
      phases: [
        {
          id: "phase",
          schedule: {
            seededMonthRange: { firstMonth: 1, lastMonth: 20 },
            randomKey: "other",
          },
          describe: () => ({ kind: "FUEL_PRICE", message: "Other" }),
        },
      ],
    };
    const key = storyPhaseKey(103, "test-arc", "onset");
    const month = resolveStoryScheduleMonth(
      definition.phases[1].schedule,
      12345,
      key,
    );
    const expected = resolveStoryAtDate(context(month), [definition, other]);
    const reordered = resolveStoryAtDate(context(month), [other, definition]);
    expect(reordered).toEqual(expected);
  });

  it("scopes definitions to their authored scenario, including custom games", () => {
    expect(
      resolveStoryAtDate(context(2, 100), [definition]).occurrences,
    ).toEqual([]);
    expect(
      resolveStoryAtDate(context(2, 999), [definition]).occurrences,
    ).toEqual([]);
  });

  it("returns the same scheduled effect throughout its forecast window", () => {
    const key = storyPhaseKey(103, "test-arc", "onset");
    const month = resolveStoryScheduleMonth(
      definition.phases[1].schedule,
      12345,
      key,
    );
    expect(resolveStoryAtDate(context(month), [definition]).effects).toEqual(
      resolveStoryAtDate(context(month + 2), [definition]).effects,
    );
    expect(
      resolveStoryAtDate(context(month + 3), [definition]).effects,
    ).toEqual({});
  });
});

describe("story effect composition", () => {
  it("multiplies multipliers, adds temperature offsets and preserves one override", () => {
    expect(
      combineStoryEffects([
        {
          effects: {
            demandMultiplier: 1.2,
            temperatureOffsetC: -4,
            fuelPriceMultipliers: { "Natural Gas": 0.75 },
            carbonFeePerKgCO2e: 0.1,
          },
        },
        {
          effects: {
            demandMultiplier: 1.1,
            temperatureOffsetC: 2,
            fuelPriceMultipliers: { "Natural Gas": 1.8 },
            carbonFeePerKgCO2e: 0.1,
          },
        },
      ]),
    ).toEqual({
      demandMultiplier: 1.32,
      temperatureOffsetC: -2,
      fuelPriceMultipliers: { "Natural Gas": 1.35 },
      carbonFeePerKgCO2e: 0.1,
    });
  });

  it("rejects overlapping carbon-fee overrides", () => {
    expect(() =>
      combineStoryEffects([
        { effects: { carbonFeePerKgCO2e: 0.08 } },
        { effects: { carbonFeePerKgCO2e: 0.1 } },
      ]),
    ).toThrow(/overlapping story carbon-fee/i);
  });
});

describe("The Shale Boom pilot arc", () => {
  const shaleContext = (
    month: number,
    difficulty: DifficultyType = "Manager",
  ) => ({
    ...context(month),
    difficulty,
  });

  it("uses the authored fixed schedule and stacks the freeze price once", () => {
    expect(
      resolveStoryAtDate(shaleContext(12)).occurrences.map(
        (event) => event.key,
      ),
    ).toEqual(["story:103:shale-boom:regional-glut-warning"]);
    expect(resolveStoryAtDate(shaleContext(48)).effects).toMatchObject({
      fuelPriceMultipliers: { "Natural Gas": 0.75 },
    });

    const freeze = resolveStoryAtDate(shaleContext(96));
    expect(freeze.occurrences[0]).toMatchObject({
      key: "story:103:shale-boom:freeze",
      importance: "CRITICAL",
      attributes: {
        effectiveGasPriceMultiplier: 1.35,
        freezeGasOutput: 0.7,
      },
    });
    expect(freeze.effects).toMatchObject({
      fuelPriceMultipliers: { "Natural Gas": 1.35 },
      facilityOutputMultipliersByFuel: { "Natural Gas": 0.7 },
    });
    expect(resolveStoryAtDate(shaleContext(99)).effects).toEqual({
      demandMultiplier: 1,
      temperatureOffsetC: 0,
      fuelPriceMultipliers: { "Natural Gas": 0.75 },
    });
    expect(resolveStoryAtDate(shaleContext(122)).effects).toEqual({});
  });

  it("checks in exact Manager values and monotonic difficulty scaling", () => {
    expect(SHALE_BOOM_BALANCE.Manager).toEqual({
      boomGasMultiplier: 0.75,
      freezeSurcharge: 1.8,
      freezeGasOutput: 0.7,
    });
    const ordered: DifficultyType[] = [
      "Intern",
      "Employee",
      "Manager",
      "VP",
      "CEO",
    ];
    const values = ordered.map((difficulty) => SHALE_BOOM_BALANCE[difficulty]);
    expect(values.map((value) => value.boomGasMultiplier)).toEqual([
      0.7, 0.725, 0.75, 0.775, 0.8,
    ]);
    expect(values.map((value) => value.freezeSurcharge)).toEqual([
      1.5, 1.65, 1.8, 1.95, 2.1,
    ]);
    expect(values.map((value) => value.freezeGasOutput)).toEqual([
      0.8, 0.75, 0.7, 0.65, 0.6,
    ]);
  });

  it("shows future phases without treating upcoming rows as active effects", () => {
    const upcoming = upcomingStoryPhases(shaleContext(47));
    expect(upcoming.map((phase) => phase.key)).toEqual([
      "story:103:shale-boom:regional-glut",
      "story:103:shale-boom:freeze-warning",
      "story:103:shale-boom:freeze",
      "story:103:shale-boom:normalization",
    ]);
    expect(resolveStoryAtDate(shaleContext(47)).effects).toEqual({});
  });

  it("authors only the scored Shale scenario in this pilot", () => {
    expect(STORY_ARC_DEFINITIONS.map((arc) => arc.scenarioId)).toEqual([103]);
    expect(resolveStoryAtDate(context(48, 999)).occurrences).toEqual([]);
  });
});
