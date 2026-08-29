import { LOCATIONS } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { StorySnapshotType } from "../Types";
import {
  combineStoryEffects,
  resolveStoryAtDate,
  resolveStoryScheduleMonth,
  StoryArcDefinitionType,
  storyPhaseKey,
} from "./WorldEvents";

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
