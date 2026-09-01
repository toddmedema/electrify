import { LOCATIONS } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { StorySnapshotType } from "../Types";
import {
  combineStoryEffects,
  CARBON_FEE_BALANCE,
  END_OF_ERA_BALANCE,
  HEATWAVE_DROUGHT_BALANCE,
  HURRICANE_BALANCE,
  PARADISE_BALANCE,
  RENEWABLES_BALANCE,
  resolveStoryAtDate,
  resolveStoryScheduleMonth,
  SHALE_BOOM_BALANCE,
  solarEclipseOutputMultiplier,
  SOLAR_ECLIPSE_MINIMUM_OUTPUT,
  STORY_ARC_DEFINITIONS,
  StoryArcDefinitionType,
  storyPhaseKey,
  TEXAS_DEEP_FREEZE_DEMAND,
  upcomingStoryPhases,
  validateStoryDifficultyMonotonicity,
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

  it("preserves a complete hydro-inflow cutoff when effects are combined", () => {
    expect(
      combineStoryEffects([
        { effects: { hydroRunoffMultiplier: 0 } },
        { effects: { hydroRunoffMultiplier: 0.5 } },
      ]).hydroRunoffMultiplier,
    ).toBe(0);
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
      "story:103:shale-boom:freeze-recovery",
      "story:103:shale-boom:normalization",
    ]);
    expect(resolveStoryAtDate(shaleContext(47)).effects).toEqual({});
  });

  it("authors every scenario with deterministic story events and no custom game", () => {
    expect(
      [...new Set(STORY_ARC_DEFINITIONS.map((arc) => arc.scenarioId))].sort(),
    ).toEqual([100, 101, 102, 103, 104, 105, 107, 108, 109, 110]);
    expect(resolveStoryAtDate(context(48, 999)).occurrences).toEqual([]);
  });
});

describe("Texas Deep Freeze", () => {
  it("uses the observed-to-unconstrained ERCOT demand range by difficulty", () => {
    expect(TEXAS_DEEP_FREEZE_DEMAND).toEqual({
      Intern: 1.2,
      Employee: 1.23,
      Manager: 1.27,
      VP: 1.3,
      CEO: 1.33,
    });
  });

  it("starts only in February 2021 and expires completely in March", () => {
    const january = resolveStoryAtDate(context(48, 107));
    const february = resolveStoryAtDate(context(49, 107));
    const march = resolveStoryAtDate(context(50, 107));

    expect(january.effects).toEqual({});
    expect(february.occurrences[0]).toMatchObject({
      key: "story:107:texas-deep-freeze:uri",
      importance: "CRITICAL",
    });
    expect(february.effects).toEqual({
      temperatureOffsetC: -20,
      demandMultiplier: 1.27,
      fuelPriceMultipliers: { "Natural Gas": 2.8 },
      facilityOutputMultipliersByFuel: {
        "Natural Gas": 0.62,
        Coal: 0.73,
        Uranium: 0.77,
        Wind: 0.44,
      },
    });
    expect(march.effects).toEqual({});
    expect(march.occurrences[0]).toMatchObject({
      key: "story:107:texas-deep-freeze:thaw",
    });
    expect(resolveStoryAtDate(context(49, 0)).effects).toEqual({});
    expect(resolveStoryAtDate(context(49, 999)).effects).toEqual({});
  });

  it("raises cold-weather demand and uses exactly one wind adjustment", () => {
    const uri = resolveStoryAtDate(context(49, 107)).occurrences[0];
    expect(uri.effects.facilityOutputMultipliersByFuel?.Wind).toBe(0.44);
    expect(uri.effects.demandMultiplier).toBe(1.27);
    expect(uri.details).toMatch(/demand is 27% above normal/i);
    expect(uri.details).toMatch(/plants can produce less/i);
  });

  it("keeps the future thaw neutral, then reports the recorded outcome", () => {
    const thawUpcoming = upcomingStoryPhases(context(0, 107)).find((phase) =>
      phase.key.endsWith(":thaw"),
    )!;
    expect(thawUpcoming.message).toMatch(/normal plant output/i);
    expect(thawUpcoming.message).not.toMatch(/supplied|recovery|blackout/i);

    const period = {
      deliveredWhByFuel: {},
      demandWh: 1,
      netIncome: 0,
      peakDemandW: 1,
    };
    const success = resolveStoryAtDate({
      ...context(50, 107),
      periodSnapshots: { 1: { ...period, unservedWh: 0 } },
    }).occurrences[0];
    const deficit = resolveStoryAtDate({
      ...context(50, 107),
      periodSnapshots: { 1: { ...period, unservedWh: 1 } },
    }).occurrences[0];
    expect(success.message).toMatch(/every customer supplied/i);
    expect(deficit.message).toMatch(/recovery/i);
  });

  it("does not claim local load shed before the simulation records a deficit", () => {
    const uri = resolveStoryAtDate(context(49, 107)).occurrences[0];
    expect(uri.message).toMatch(/power supplies across Texas/i);
    expect(uri.message).not.toMatch(/load shed|ERCOT/i);
  });
});

describe("generation and storage reliability scenarios", () => {
  it("progressively reduces hydro and nuclear output through the heatwave", () => {
    const june = resolveStoryAtDate(context(29, 108));
    const july = resolveStoryAtDate(context(30, 108));
    const august = resolveStoryAtDate(context(31, 108));

    expect(june.effects).toMatchObject({
      demandMultiplier: 1.08,
      hydroRunoffMultiplier: 0.6,
      facilityOutputMultipliersByFuel: { Hydro: 0.8, Uranium: 0.9 },
    });
    expect(july.effects.hydroRunoffMultiplier).toBe(0.4);
    expect(august.effects).toMatchObject({
      demandMultiplier: 1.16,
      hydroRunoffMultiplier: 0.22,
      facilityOutputMultipliersByFuel: { Hydro: 0.5, Uranium: 0.62 },
    });
    expect(resolveStoryAtDate(context(32, 108)).effects).toEqual({});
    expect(HEATWAVE_DROUGHT_BALANCE.Intern.demandMultipliers[2]).toBeLessThan(
      HEATWAVE_DROUGHT_BALANCE.CEO.demandMultipliers[2],
    );
  });

  it("models the eclipse as a known intraday fall and recovery", () => {
    const effects = resolveStoryAtDate(context(32, 109)).effects;
    expect(effects.solarEclipse).toMatchObject({
      startsMinuteOfDay: 510,
      totalityMinuteOfDay: 600,
      endsMinuteOfDay: 690,
      minimumOutputMultiplier: SOLAR_ECLIPSE_MINIMUM_OUTPUT.Manager,
    });
    expect(solarEclipseOutputMultiplier(effects, 510)).toBe(1);
    expect(solarEclipseOutputMultiplier(effects, 555)).toBeCloseTo(0.54);
    expect(solarEclipseOutputMultiplier(effects, 600)).toBe(0.08);
    expect(solarEclipseOutputMultiplier(effects, 645)).toBeCloseTo(0.54);
    expect(solarEclipseOutputMultiplier(effects, 690)).toBe(1);
  });

  it("keeps the seeded nuclear trip hidden and targets a paused unit at onset", () => {
    const snapshot: StorySnapshotType = {
      ...EMPTY_SNAPSHOT,
      facilities: [
        {
          id: 7,
          name: "Grand Nuclear Unit",
          fuel: "Uranium",
          ageYears: 22,
          peakW: 500_000_000,
          // Pausing the reactor must not let it escape a mechanical shutdown and resume later.
          operational: false,
        },
      ],
    };
    const before = { ...context(0, 110, 77), snapshot };
    expect(
      upcomingStoryPhases(before).some((phase) => phase.key.endsWith(":trip")),
    ).toBe(false);
    const arc = STORY_ARC_DEFINITIONS.find((item) => item.scenarioId === 110)!;
    const tripPhase = arc.phases.find((phase) => phase.id === "trip")!;
    const month = resolveStoryScheduleMonth(
      tripPhase.schedule,
      77,
      storyPhaseKey(110, arc.id, tripPhase.id),
    );
    expect(month).toBeGreaterThanOrEqual(30);
    expect(month).toBeLessThanOrEqual(36);
    const trip = resolveStoryAtDate({
      ...context(month, 110, 77),
      snapshot,
    }).occurrences[0];
    expect(trip.forecastable).toBe(false);
    expect(trip.effects.facilityOutputMultipliersById).toEqual({ "7": 0 });
    expect(trip.attributes.selectedFacilityNames).toEqual([
      "Grand Nuclear Unit",
    ]);
  });

  it("uses short preview copy before the eclipse and precise copy at onset", () => {
    const upcoming = upcomingStoryPhases(context(0, 109));
    const warning = upcoming.find((phase) =>
      phase.key.endsWith(":advance-warning"),
    )!;
    const eclipse = upcoming.find((phase) => phase.key.endsWith(":eclipse"))!;

    expect(warning).toMatchObject({
      title: "Eclipse planning ahead",
      message: "Grid planners will begin preparing for a total eclipse.",
      details: undefined,
    });
    expect(eclipse).toMatchObject({
      title: "Total solar eclipse",
      message: "A total eclipse will briefly reduce solar generation.",
      details: undefined,
    });
    expect(eclipse.message).not.toMatch(/underway|08:30|10:00|11:30/i);

    const live = resolveStoryAtDate(context(32, 109)).occurrences[0];
    expect(live.title).toBe("The eclipse is underway");
    expect(live.details).toMatch(/08:30.*10:00.*11:30/i);
  });
});

describe("remaining scored story arcs", () => {
  it("checks in exact Manager reference values and monotonic scaling", () => {
    expect(CARBON_FEE_BALANCE.Manager).toBe(100);
    expect(PARADISE_BALANCE.Manager).toEqual({
      visitorDemand: 1.06,
      oilShock: 1.45,
    });
    expect(RENEWABLES_BALANCE.Manager).toEqual({
      bridgeGasBuildCost: 1,
      solarBuildCost: 0.75,
      windBuildCost: 0.9,
      demandLoad: 1.08,
    });
    expect(HURRICANE_BALANCE.Manager).toEqual({
      severity: "Major",
      targetCapacityShare: 0.3,
      outputMultiplier: 0.6,
      durationMonths: 4,
      oilMultiplier: 1.4,
    });
    expect(END_OF_ERA_BALANCE.Manager).toEqual({
      oldCoalOutput: 0.85,
      coalOM: 1.2,
      complianceCoalOutput: 0.75,
    });
    expect(validateStoryDifficultyMonotonicity()).toEqual([]);
  });

  it("applies each fixed Manager effect at its exact boundary", () => {
    expect(resolveStoryAtDate(context(48, 100)).effects).toMatchObject({
      carbonFeePerKgCO2e: 0.1,
    });
    expect(resolveStoryAtDate(context(28, 105)).effects).toMatchObject({
      demandMultiplier: 1.06,
    });
    expect(resolveStoryAtDate(context(84, 101)).effects).toMatchObject({
      buildCostMultipliersByFuel: { Sun: 0.75, Wind: 0.9 },
    });
    expect(resolveStoryAtDate(context(180, 102)).effects).toMatchObject({
      operatingCostMultipliersByFuel: { Coal: 1.2 },
      facilityOutputMultipliersByFuel: { Coal: 0.75 },
    });
  });

  it("selects hurricane capacity stably rather than depending on fleet order", () => {
    const snapshot: StorySnapshotType = {
      ...EMPTY_SNAPSHOT,
      facilities: [
        {
          id: 10,
          name: "Oil A",
          fuel: "Oil",
          ageYears: 10,
          peakW: 100,
          operational: true,
        },
        {
          id: 11,
          name: "Gas B",
          fuel: "Natural Gas",
          ageYears: 10,
          peakW: 300,
          operational: true,
        },
        {
          id: 12,
          name: "Storage",
          ageYears: 1,
          peakW: 1000,
          operational: true,
        },
      ],
    };
    const landfallMonth = resolveStoryScheduleMonth(
      STORY_ARC_DEFINITIONS.find((arc) => arc.scenarioId === 104)!.phases[1]
        .schedule,
      77,
      storyPhaseKey(104, "hurricane-2008", "landfall"),
    );
    const resolve = (facilities: StorySnapshotType["facilities"]) =>
      resolveStoryAtDate({
        ...context(landfallMonth, 104, 77),
        snapshot: { ...snapshot, facilities },
      }).occurrences.find((event) => event.definitionId.endsWith("landfall"));
    const first = resolve(snapshot.facilities)!;
    const reordered = resolve([...snapshot.facilities].reverse())!;
    expect(first.attributes.selectedFacilityIds).toEqual(
      reordered.attributes.selectedFacilityIds,
    );
    expect(first.attributes.selectedCapacityShare).toBeGreaterThanOrEqual(0.3);
    expect(first.effects.facilityOutputMultipliersById).toBeDefined();
    expect(first.effects.facilityOutputMultipliersById?.["12"]).toBeUndefined();
  });

  it("reports exact hurricane restoration-window totals", () => {
    const hurricane = STORY_ARC_DEFINITIONS.find(
      (arc) => arc.scenarioId === 104,
    )!;
    const landfallMonth = resolveStoryScheduleMonth(
      hurricane.phases[1].schedule,
      77,
      storyPhaseKey(104, "hurricane-2008", "landfall"),
    );
    const restoration = resolveStoryAtDate({
      ...context(landfallMonth + 4, 104, 77),
      periodSnapshots: {
        4: {
          deliveredWhByFuel: { Oil: 50 },
          demandWh: 100,
          unservedWh: 2,
          netIncome: -1,
          peakDemandW: 10,
        },
      },
      occurrences: [
        {
          key: "story:104:hurricane-2008:landfall",
          definitionId: "hurricane-2008:landfall",
          startsMinute: landfallMonth * MINUTES_PER_MONTH,
          endsMinute: (landfallMonth + 4) * MINUTES_PER_MONTH,
          attributes: { selectedFacilityNames: ["Oil A"] },
          effects: {},
        },
      ],
    }).occurrences.find((event) => event.definitionId.endsWith("restoration"))!;
    expect(restoration.attributes).toMatchObject({
      demandWh: 100,
      unservedWh: 2,
      reliability: 0.98,
    });
    expect(restoration.message).toMatch(/met 98% of demand/);
  });

  it("branches checkpoints from persisted simulation facts", () => {
    const strongSnapshot: StorySnapshotType = {
      ...EMPTY_SNAPSHOT,
      deliveredWhByFuel12m: { "Natural Gas": 30 },
      demandWh12m: 100,
      unservedWh12m: 0,
      netIncome12m: 1,
      peakDemandW12m: 100,
      firmPeakW: 80,
      storagePeakW: 20,
    };
    const normalization = resolveStoryAtDate({
      ...context(122, 103),
      snapshot: strongSnapshot,
    }).occurrences[0];
    expect(normalization.message).toMatch(/reliable/i);
    expect(normalization.attributes).toMatchObject({
      gasShare: 0.3,
      reliability: 1,
    });
  });
});
