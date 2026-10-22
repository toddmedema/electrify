import { OFFICIAL_SCENARIO_RULES } from "../data/OfficialScenarioRules";
import {
  compileOfficialArcEvents,
  officialArcLoadScale,
  officialArcMoneyAmount,
  relocateOfficialArcMonth,
  validOfficialArcMetadata,
  type OfficialArcCompileParameters,
} from "./ScenarioRuleArcs";
import {
  resolveStoryPhase,
  STORY_ARC_DEFINITIONS,
  type StoryContextType,
} from "../data/WorldEvents";
import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import { DIFFICULTY_IDS } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import {
  resolveScenarioRuleTargets,
  type ScenarioRuleTargetFacility,
} from "./ScenarioRuleTargets";
import { prepareCustomScenario } from "./CustomScenarioEvents";
import { getScenarioLocation } from "./Locations";
import type { RuleDiagnostic } from "../data/ScenarioRules";

const challenges = SCENARIOS.filter((scenario) => !scenario.tutorialSteps);
const source = (id: number) =>
  challenges.find((scenario) => scenario.id === id)!;
const params = (
  patch: Partial<OfficialArcCompileParameters> = {},
): OfficialArcCompileParameters => ({
  namespace: { kind: "mod", id: "arc-test" },
  difficulty: "Manager",
  seed: 12345,
  startingYear: 2050,
  durationMonths: 240,
  startingAssetIds: ["scenario-110-grand-nuclear-unit"],
  receivingScenario: { ...DEFAULT_CUSTOM_SCENARIO, startingYear: 2050 },
  ...patch,
});
const compile = (
  ids: number[],
  patch: Partial<OfficialArcCompileParameters> = {},
) => compileOfficialArcEvents(params(patch), ids);

function context(scenarioId: number, settings = params()): StoryContextType {
  return {
    seed: settings.seed,
    scenarioId,
    difficulty: settings.difficulty,
    date: getDateFromMinute(0, settings.startingYear),
    location: getScenarioLocation(source(scenarioId))!,
    snapshot: {
      deliveredWhByFuel12m: {},
      demandWh12m: 0,
      unservedWh12m: 0,
      netIncome12m: 0,
      peakDemandW12m: 0,
      firmPeakW: 0,
      storagePeakW: 0,
      storagePeakWh: 0,
      facilities: [],
    },
  };
}

test("all fourteen importable challenges compile detached JSON and data-center keeps its load-only arc", () => {
  expect(challenges).toHaveLength(14);
  const events = compile(challenges.map((scenario) => scenario.id));
  expect(events).toHaveLength(
    STORY_ARC_DEFINITIONS.reduce((total, arc) => total + arc.phases.length, 0) +
      OFFICIAL_SCENARIO_RULES.reduce(
        (total, arc) => total + (arc.definitions.events?.length ?? 0),
        0,
      ),
  );
  expect(compile([106])).toEqual([]);
  expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  expect(new Set(events.map((event) => event.key)).size).toBe(events.length);
  for (const event of events) {
    expect(validOfficialArcMetadata(event)).toBe(true);
    expect(event.effects.facilityOutputMultipliersById).toBeUndefined();
    expect(event.reports?.length ?? 0).toBeLessThanOrEqual(4);
  }
  const arc = STORY_ARC_DEFINITIONS[0];
  const original = arc.phases[0].describe;
  try {
    arc.phases[0].describe = () => {
      throw new Error("Installed catalog is no longer available");
    };
    expect(
      JSON.parse(JSON.stringify(events)).every(validOfficialArcMetadata),
    ).toBe(true);
  } finally {
    arc.phases[0].describe = original;
  }
});

test("trusted pilot forecast titles survive transfer while hostile metadata is rejected", () => {
  const event = compile([113]).find((item) => item.source.previewTitle)!;
  expect(validOfficialArcMetadata(JSON.parse(JSON.stringify(event)))).toBe(
    true,
  );
  for (const previewTitle of [
    "",
    " ",
    "x".repeat(121),
    "<script>bad</script>",
    "https://example.com",
    "hidden\u202etitle",
    "bad\nline",
  ]) {
    expect(
      validOfficialArcMetadata({
        ...event,
        source: { ...event.source, previewTitle },
      }),
    ).toBe(false);
  }
  expect(validOfficialArcMetadata(event)).toBe(true);
  const originalTitle = event.source.previewTitle;
  event.source.previewTitle = "Changed imported forecast";
  expect(
    compile([113]).find((item) => item.id === event.id)!.source.previewTitle,
  ).toBe(originalTitle);
});

test.each(DIFFICULTY_IDS)(
  "preserves every phase's trusted schedule and static effects on %s",
  (difficulty) => {
    for (const scenario of challenges) {
      const settings = params({
        namespace: {
          kind: "official",
          scenarioId: scenario.id,
          arcId: "catalog",
        },
        difficulty,
        startingYear: scenario.startingYear,
        receivingScenario: scenario,
      });
      const events = compileOfficialArcEvents(settings, [scenario.id]);
      for (const arc of STORY_ARC_DEFINITIONS.filter(
        (item) => item.scenarioId === scenario.id,
      )) {
        for (const phase of arc.phases) {
          const legacy = resolveStoryPhase(
            arc,
            phase,
            context(scenario.id, settings),
          );
          const event = events.find(
            (item) => item.source.phaseId === phase.id,
          )!;
          const effects = { ...legacy.effects };
          delete effects.facilityOutputMultipliersById;
          expect(event.key).toBe(legacy.key);
          expect(event.startMonth * MINUTES_PER_MONTH).toBe(
            legacy.startsMinute,
          );
          expect(event.durationMonths * MINUTES_PER_MONTH).toBe(
            legacy.endsMinute - legacy.startsMinute,
          );
          expect(event.effects).toEqual(effects);
          expect(event.visibility).toBe(
            phase.forecastable === false ? "surprise" : "forecast",
          );
        }
      }
    }
  },
);

test("linked hurricane recovery shares the original addressed onset across every difficulty and seeded month", () => {
  const reached = new Set<number>();
  for (const difficulty of DIFFICULTY_IDS) {
    for (let seed = 0; seed < 60; seed++) {
      const events = compile([104], { difficulty, seed });
      const onset = events.find(
        (event) => event.source.phaseId === "landfall",
      )!;
      const recovery = events.find(
        (event) => event.source.phaseId === "restoration",
      )!;
      reached.add(onset.startMonth);
      expect(recovery.startMonth).toBe(onset.startMonth + onset.durationMonths);
      expect(onset.possibleStartMonths).toEqual({ from: 101, to: 106 });
      expect(recovery.possibleStartMonths).toEqual({
        from: 101 + onset.durationMonths,
        to: 106 + onset.durationMonths,
      });
      expect(
        recovery.reports?.find((report) => report.kind === "reliability"),
      ).toEqual(
        expect.objectContaining({
          fromMonth: onset.startMonth,
          throughMonth: recovery.startMonth - 1,
        }),
      );
    }
  }
  expect([...reached].sort((a, b) => a - b)).toEqual([
    101, 102, 103, 104, 105, 106,
  ]);
});

test("relocation keeps preparation for phases and choices and already-prepared absolute load offsets", () => {
  for (const scenario of challenges) {
    for (const load of scenario.loadAdditions ?? []) {
      const offset =
        (load.startsYear - scenario.startingYear) * 12 +
        (load.startsMonth ?? 1) -
        1;
      expect(relocateOfficialArcMonth(scenario.id, offset, "load")).toBe(
        offset,
      );
    }
  }
  expect(relocateOfficialArcMonth(111, 12, "phase")).toBe(36);
  expect(relocateOfficialArcMonth(111, 11, "choice")).toBe(35);
  expect(relocateOfficialArcMonth(110, 30, "phase")).toBe(42);
  const campus = source(106).loadAdditions![0];
  const offset = relocateOfficialArcMonth(
    106,
    (campus.startsYear - source(106).startingYear) * 12,
    "load",
  );
  const prepared = prepareCustomScenario({
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 2050,
    eventScenarioIds: [106],
  });
  expect(prepared.loadAdditions?.[0].startsYear).toBe(2050 + offset / 12);
  expect(prepared.loadAdditions?.[0].startsYear).toBe(2056);
  expect(compile([111])[0].startMonth).toBeGreaterThanOrEqual(24);
});

test("imported repair budgets scale with receiving size and era while percentage effects do not", () => {
  const receiving = {
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 2050,
    startingCustomers: 100000,
  };
  const settings = params({ receivingScenario: receiving });
  const event = compileOfficialArcEvents(settings, [111]).find(
    (item) => item.source.phaseId === "firestorm",
  )!;
  const original = compile([111], {
    namespace: { kind: "official", scenarioId: 111, arcId: "wildfire" },
    receivingScenario: source(111),
  }).find((item) => item.source.phaseId === "firestorm")!;
  expect(event.effects.operatingExpensePerMonth).toBeCloseTo(
    officialArcMoneyAmount(
      original.effects.operatingExpensePerMonth!,
      source(111),
      receiving,
    ),
    5,
  );
  expect(event.effects.demandMultiplier).toBe(
    original.effects.demandMultiplier,
  );
  expect(event.targets).toEqual(original.targets);
  expect(
    officialArcLoadScale(source(106), {
      ...source(106),
      startingCustomers: source(106).startingCustomers! * 2,
    }),
  ).toBe(2);
});

test("activation-dependent targets and preparation are data rather than opening-fleet observations", () => {
  const events = compile([102, 104, 107, 110, 111]);
  const phase = (id: number, phaseId: string) =>
    events.find(
      (event) =>
        event.source.scenarioId === id && event.source.phaseId === phaseId,
    )!;
  expect(phase(102, "aging-derate").targets).toEqual([
    {
      target: {
        selector: "operatingAtLeastAge",
        fuel: "Coal",
        minAgeYears: 30,
      },
      outputMultiplier: expect.any(Number),
    },
  ]);
  expect(phase(110, "trip").targets).toEqual([
    {
      target: {
        selector: "startingAsset",
        assetId: "scenario-110-grand-nuclear-unit",
      },
      outputMultiplier: 0,
    },
  ]);
  expect(phase(110, "trip").preview).toBeUndefined();
  expect(phase(110, "trip").visibility).toBe("surprise");
  expect(phase(107, "uri").protection).toEqual({
    kind: "deepFreezeWinterization",
  });
  expect(phase(111, "firestorm").protection).toEqual({
    kind: "wildfirePreparedness",
  });
  expect(phase(104, "landfall").source.drawKey).toBe(
    "story:104:hurricane-2008:landfall",
  );
  expect(phase(111, "firestorm").source.drawKey).toBe(
    "story:111:california-wildfire-2025:firestorm",
  );
});

test("report definitions retain exact observation windows and never freeze an empty history as success", () => {
  const events = compile([101, 102, 103, 104, 105, 107, 111]);
  for (const phaseId of [
    "normalization",
    "integration-review",
    "successor-review",
    "local-energy-review",
    "restoration",
    "restoration-complete",
    "thaw",
  ]) {
    const event = events.find((item) => item.source.phaseId === phaseId)!;
    expect(event.reports?.length).toBeGreaterThan(0);
    expect(event.message).not.toMatch(
      /100%|0%|profitable|every customer|met .*demand/,
    );
    expect(
      event
        .reports!.filter((report) => "throughMonth" in report)
        .map((report) =>
          "throughMonth" in report ? report.throughMonth : undefined,
        ),
    ).toEqual(
      event
        .reports!.filter((report) => "throughMonth" in report)
        .map(() => event.startMonth - 1),
    );
  }
  expect(
    events
      .find((item) => item.source.phaseId === "successor-review")!
      .reports?.map((report) => report.kind),
  ).toEqual(["fuelMix", "reliability", "profitLoss", "firmCoverage"]);
});

test("invalid nuclear base and outside-term placements diagnose before activation, with valid neighbors", () => {
  const diagnostics: RuleDiagnostic[] = [];
  compile([110], { startingAssetIds: [], diagnostics });
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "missing-starting-asset",
        severity: "error",
      }),
    ]),
  );
  expect(() => compile([110], { startingAssetIds: [] })).toThrow(
    "scenario-110-grand-nuclear-unit",
  );
  const valid: RuleDiagnostic[] = [];
  compile([110], { diagnostics: valid });
  expect(valid.filter((item) => item.severity === "error")).toEqual([]);
  const outside: RuleDiagnostic[] = [];
  compile([104], { durationMonths: 106, diagnostics: outside });
  expect(outside).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "outside-term" })]),
  );
  const clipped: RuleDiagnostic[] = [];
  const trip = compile([110], {
    durationMonths: 49,
    diagnostics: clipped,
  }).find((item) => item.source.phaseId === "trip")!;
  expect(trip.startMonth + trip.durationMonths).toBe(49);
  expect(clipped).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "duration-truncated",
        severity: "warning",
      }),
    ]),
  );
});

test("detached metadata rejects authored RNG keys, callbacks and unknown fields with valid neighbors", () => {
  const event = compile([104]).find(
    (item) => item.source.phaseId === "landfall",
  )!;
  expect(validOfficialArcMetadata(event)).toBe(true);
  expect(
    validOfficialArcMetadata({
      ...event,
      source: { ...event.source, drawKey: "mod:reroll" },
    }),
  ).toBe(false);
  expect(
    validOfficialArcMetadata({
      ...event,
      source: { ...event.source, callback: () => 1 },
    }),
  ).toBe(false);
  expect(
    validOfficialArcMetadata({
      ...event,
      source: { ...event.source, extra: 1 },
    }),
  ).toBe(false);
  expect(
    validOfficialArcMetadata({
      ...event,
      protection: { kind: "deepFreezeWinterization" },
    }),
  ).toBe(false);
  expect(
    validOfficialArcMetadata({
      ...event,
      source: { ...event.source, turningPointPriority: Infinity },
    }),
  ).toBe(false);
});

test("compile order is canonical and nondefault years preserve receiving calendar titles", () => {
  expect(compile([111, 104, 103])).toEqual(compile([103, 104, 111]));
  const event = compile([104], {
    startingYear: 2070,
    receivingScenario: { ...DEFAULT_CUSTOM_SCENARIO, startingYear: 2070 },
  }).find((item) => item.source.phaseId === "outlook")!;
  expect(event.title).toContain("2075");
  expect(event.title).not.toContain("2008");
});

const targetFleet: ScenarioRuleTargetFacility[] = [
  {
    id: 1,
    name: "Old coal",
    fuel: "Coal",
    ageYears: 40,
    peakW: 75,
    operational: true,
    minuteCreated: -1000,
  },
  {
    id: 2,
    name: "River gas",
    fuel: "Natural Gas",
    ageYears: 30,
    peakW: 250,
    operational: true,
    minuteCreated: -2000,
  },
  {
    id: 3,
    name: "Hill coal",
    fuel: "Coal",
    ageYears: 30,
    peakW: 175,
    operational: true,
    minuteCreated: -3000,
  },
  {
    id: 4,
    name: "Solar",
    fuel: "Sun",
    ageYears: 3,
    peakW: 50,
    operational: true,
    minuteCreated: -4000,
  },
  {
    id: 5,
    name: "Battery",
    ageYears: 1,
    peakW: 900,
    operational: true,
    minuteCreated: -5000,
  },
  {
    id: 6,
    name: "Paused gas",
    fuel: "Natural Gas",
    ageYears: 10,
    peakW: 1000,
    operational: false,
    minuteCreated: -6000,
  },
];

// Captured from the pre-conversion callbacks. Keep these independent when those callbacks retire.
const expectedTargets = {
  104: {
    Intern: [[2], [2], [2]],
    Employee: [[2], [2], [2]],
    Manager: [[2], [2], [2]],
    VP: [[2], [2], [2]],
    CEO: [
      [2, 3],
      [2, 1, 4],
      [2, 3],
    ],
  },
  111: {
    Intern: [[2], [1, 2], [2]],
    Employee: [[2], [1, 2], [2]],
    Manager: [
      [2, 1],
      [1, 2],
      [2, 1],
    ],
    VP: [
      [2, 1, 3],
      [1, 2, 3],
      [2, 1, 4],
    ],
    CEO: [
      [2, 1, 3],
      [1, 2, 3],
      [2, 1, 4, 3],
    ],
  },
};
const expectedNames: Record<number, string> = {
  1: "Old coal",
  2: "River gas",
  3: "Hill coal",
  4: "Solar",
};

test.each([104, 111] as const)(
  "preserves independent pre-conversion IDs and names for all fifteen %s target draws",
  (scenarioId) => {
    for (const difficulty of DIFFICULTY_IDS) {
      for (const [index, seed] of [1, 42, 12345].entries()) {
        const event = compile([scenarioId], { difficulty, seed }).find(
          (item) =>
            item.source.phaseId ===
            (scenarioId === 104 ? "landfall" : "firestorm"),
        )!;
        const ids = expectedTargets[scenarioId][difficulty][index];
        for (const facilities of [targetFleet, [...targetFleet].reverse()]) {
          const targets = resolveScenarioRuleTargets(event.targets[0].target, {
            seed,
            eventKey: event.key,
            officialDrawKey: event.source.drawKey,
            facilities,
          }).targets;
          expect(targets.map((target) => target.id)).toEqual(ids);
          expect(targets.map((target) => target.name)).toEqual(
            ids.map((id) => expectedNames[id]),
          );
        }
      }
    }
  },
);
