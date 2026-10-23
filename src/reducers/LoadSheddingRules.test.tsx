import { deserialize, serialize } from "v8";
import cloneDeep from "lodash.clonedeep";
import { createNextState } from "@reduxjs/toolkit";
import { DIFFICULTY_IDS, TICKS_PER_MONTH } from "../Constants";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import {
  packProjection,
  projectionDecoder,
} from "../components/base/ProjectionTransport";
import { DEFAULT_CUSTOM_SCENARIO, getScenario } from "../data/Scenarios";
import type { CompiledScenarioRules } from "../data/ScenarioRules";
import {
  resolveStoryAtDate,
  upcomingStoryPhases,
  type StoryContextType,
} from "../data/WorldEvents";
import { accessContextForGame } from "../data/IntertieAccess";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { selectProjection } from "../helpers/Projection";
import { compileOfficialArcEvents } from "../helpers/ScenarioRuleArcs";
import {
  customEventContext,
  prepareCustomScenario,
} from "../helpers/CustomScenarioEvents";
import {
  captureRuleReportObservation,
  interpretScenarioRuleReport,
} from "../helpers/ScenarioRuleRuntime";
import { scenarioRules, scenarioRulesIdentity } from "../helpers/ScenarioRules";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { buildStorySnapshot } from "../helpers/Story";
import { serializeReplay } from "../Replay";
import { canonical, digest } from "../testing/CanonicalHash";
import { STANDARD_BALANCE_PLAYS } from "../testing/BalancePlaybooks";
import { parseSave, serializeSave } from "../SaveGame";
import {
  createGame,
  createGameFromReplay,
  runSimulation,
} from "../testing/Simulator";
import type { ActiveWorldEventType, GameType } from "../Types";
import { generateNewTimeline, tickState } from "./Game";

const context = (game: GameType): StoryContextType => ({
  scenarioId: game.scenarioId,
  difficulty: game.difficulty,
  seed: game.seed,
  date: game.date,
  location: game.location,
  occurrences: game.worldEvents.occurrences,
  snapshot: buildStorySnapshot(
    game.monthlyHistory,
    game.facilities,
    game.date.minute,
  ),
});
const advance = (game: GameType, minute: number) => {
  while (game.date.minute < minute) tickState(game);
  expect(game.date.minute).toBe(minute);
};

test.each(DIFFICULTY_IDS)(
  "the official %s starting grid uses native rules",
  (difficulty) => {
    const game = createGame({ scenarioId: 113, difficulty, seed: 12345 });
    expect(game.customScenario).toBeUndefined();
    expect(accessContextForGame(game).scenarioId).toBe(113);
    const rules = scenarioRules(getScenario(113), game)!;
    expect(rules.namespace.kind).toBe("official");
    expect(
      rules.events.map((event) => event.startMonth).sort((a, b) => a - b),
    ).toEqual([30, 36, 48, 60, 72]);
    expect(rules.objectives[0]).toMatchObject({
      metric: "monthlyReliability",
      fromMonth: 72,
      throughMonth: 83,
    });
  },
);

test("trusted compiled pilot identities bind actual difficulty and seed without mutable cache poisoning", () => {
  const scenario = getScenario(113)!;
  const parameters = { difficulty: "CEO" as const, seed: 1 };
  const original = scenarioRules(scenario, parameters)!;
  expect(scenarioRules(scenario, parameters)).toBe(original);
  expect(Object.isFrozen(original.events[0].effects)).toBe(true);
  const otherDifficulty = scenarioRules(scenario, {
    ...parameters,
    difficulty: "Employee",
  })!;
  const otherSeed = scenarioRules(scenario, { ...parameters, seed: 12345 })!;
  expect(otherDifficulty).not.toBe(original);
  expect(otherSeed.seed).toBe(12345);
  expect(scenarioRulesIdentity(otherDifficulty)).not.toBe(
    scenarioRulesIdentity(original),
  );
  expect(scenarioRulesIdentity(otherSeed)).not.toBe(
    scenarioRulesIdentity(original),
  );
  const mutable = cloneDeep(original);
  const before = scenarioRulesIdentity(mutable);
  mutable.events[0].effects.facilityOutputMultipliersByFuel = { Coal: 0.25 };
  expect(scenarioRulesIdentity(mutable)).not.toBe(before);
  expect(scenarioRulesIdentity(original)).toBe(
    scenarioRulesIdentity(scenarioRules(scenario, parameters)),
  );
});

test("a mutable trusted cost edit changes the actual cached future forecast", () => {
  const scenario = getScenario(113)!;
  const previous = scenario.rules;
  const mutable = cloneDeep(
    scenarioRules(scenario, { difficulty: "Employee", seed: 12345 })!,
  );
  const event = mutable.events.find(
    (event) => event.id === "availability-step-1",
  )!;
  event.startMonth = 1;
  event.durationMonths = 2;
  event.effects = { operatingExpensePerMonth: 100 };
  scenario.rules = mutable;
  try {
    const game = createGame({
      scenarioId: 113,
      difficulty: "Employee",
      seed: 12345,
    });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const forecast = () =>
      generateNewTimeline(
        game,
        now.cash,
        now.customers,
        2 * TICKS_PER_MONTH,
      ).find(
        (tick) =>
          tick.minute ===
          MINUTES_PER_MONTH + MINUTES_PER_MONTH / TICKS_PER_MONTH,
      )!;
    const baseline = forecast();
    expect(baseline).toBeDefined();
    event.effects.operatingExpensePerMonth = 1e6;
    const changed = forecast();
    expect(changed.expensesOM).toBeGreaterThan(baseline.expensesOM);
    expect(changed.demandW).toBe(baseline.demandW);
  } finally {
    if (previous) scenario.rules = previous;
    else delete scenario.rules;
  }
});

const PROFILES = ["strong", "weak", "unavailable"] as const;
/** Probes both recorded availability extremes and missing history. */
function profileProbe(
  game: GameType,
  profile: (typeof PROFILES)[number],
): StoryContextType {
  const probe = context(game);
  if (profile === "unavailable") return probe;
  const strong = profile === "strong";
  probe.snapshot = {
    ...probe.snapshot,
    demandWh12m: 1e12,
    unservedWh12m: strong ? 0 : 5e10,
    netIncome12m: strong ? 1e6 : -1e6,
    peakDemandW12m: 1e9,
    firmPeakW: strong ? 1.1e9 : 3e8,
    storagePeakW: strong ? 2e8 : 1e7,
    storagePeakWh: strong ? 8e8 : 2e7,
    deliveredWhByFuel12m: strong
      ? { Coal: 1e11, "Natural Gas": 2e11, Wind: 3e11, Sun: 2e11, Hydro: 2e11 }
      : { Coal: 7e11, "Natural Gas": 2e11, Wind: 2e10, Sun: 1e10, Hydro: 2e10 },
  };
  probe.periodSnapshots = Object.fromEntries(
    [1, 2, 3, 4, 6, 12, 24].map((months) => [
      months,
      {
        deliveredWhByFuel: probe.snapshot.deliveredWhByFuel12m,
        demandWh: probe.snapshot.demandWh12m,
        unservedWh: probe.snapshot.unservedWh12m,
        netIncome: probe.snapshot.netIncome12m,
        peakDemandW: probe.snapshot.peakDemandW12m,
      },
    ]),
  );
  return probe;
}
/** Resolves each declared phase at its onset, accumulating receipts as play would. */
function phasesAtOnset(probe: StoryContextType, game: GameType) {
  const rules = scenarioRules(getScenario(113), game)!;
  const receipts: ActiveWorldEventType[] = [];
  return rules.events.map((event) => {
    probe.date = getDateFromMinute(
      event.startMonth * MINUTES_PER_MONTH,
      game.startingYear,
    );
    probe.occurrences = receipts;
    const actual = resolveStoryAtDate(probe).occurrences.find(
      (item) => item.key === event.key,
    )!;
    expect(actual).toBeDefined();
    receipts.push(actual);
    return actual;
  });
}

test.each(DIFFICULTY_IDS)(
  "%s phase and forecast facts are pinned for every availability profile",
  (difficulty) => {
    const hashes: Record<string, string> = {};
    for (const profile of PROFILES) {
      const game = createGame({ scenarioId: 113, difficulty, seed: 12345 });
      const probe = profileProbe(game, profile);
      const previews = upcomingStoryPhases(probe);
      const phases = phasesAtOnset(probe, game);
      hashes[profile] = digest({ previews, phases });
      for (const phase of phases.filter(
        (phase) => phase.endsMinute > phase.startsMinute,
      )) {
        const at = (minute: number) =>
          resolveStoryAtDate({
            ...probe,
            date: getDateFromMinute(minute, game.startingYear),
          }).active.some((event) => event.key === phase.key);
        expect(at(phase.endsMinute - 1)).toBe(true);
        expect(at(phase.endsMinute)).toBe(false);
      }
    }
    expect({
      grid: digest(
        createGame({ scenarioId: 113, difficulty, seed: 12345 }).facilities,
      ),
      ...hashes,
    }).toMatchSnapshot();
  },
);

test.each(DIFFICULTY_IDS)(
  "the same plain definitions compile %s official, community and raw custom imports",
  (difficulty) => {
    for (const seed of [1, 12345]) {
      const official = scenarioRules(getScenario(113), { difficulty, seed })!;
      const compiled = compileOfficialArcEvents(
        {
          namespace: { kind: "mod", id: "pilot-import" },
          difficulty,
          seed,
          startingYear: 2050,
          durationMonths: 84,
          startingAssetIds: [],
          receivingScenario: { ...DEFAULT_CUSTOM_SCENARIO, startingYear: 2050 },
        },
        [113],
      );
      expect(compiled).toHaveLength(5);
      for (const phase of official.events) {
        const event = compiled.find(
          (event) => event.source.phaseId === phase.id,
        )!;
        expect(event.key).toBe(
          `mod:pilot-import:arc:113:load-shedding:${event.source.phaseId}`,
        );
        expect(event.startMonth).toBe(phase.startMonth);
        expect(event.effects).toEqual(phase.effects);
        expect(event.source.scenarioId).toBe(113);
      }
    }
    const custom = prepareCustomScenario({
      ...DEFAULT_CUSTOM_SCENARIO,
      startingYear: 2050,
      durationMonths: 84,
      eventScenarioIds: [113],
    });
    const game = createGame({
      scenarioId: 999,
      scenario: custom,
      difficulty,
      seed: 12345,
    });
    const official = createGame({ scenarioId: 113, difficulty, seed: 12345 });
    const expected = phasesAtOnset(context(official), official);
    for (const phase of expected) {
      const result = resolveStoryAtDate({
        ...context(game),
        date: getDateFromMinute(phase.startsMinute, game.startingYear),
        customEvents: customEventContext(game.customScenario),
      });
      expect(
        result.occurrences.find(
          (event) =>
            event.key.split(":").at(-1) === phase.key.split(":").at(-1),
        )?.effects,
      ).toEqual(phase.effects);
    }
  },
);

test("an actual onset preserves plain, Immer batch, worker, save and internal replay results", () => {
  const before = createGame({ scenarioId: 113, difficulty: "CEO", seed: 1 });
  advance(before, 36 * MINUTES_PER_MONTH - MINUTES_PER_MONTH / TICKS_PER_MONTH);
  const plain = cloneDeep(before);
  for (let i = 0; i < 12; i++) tickState(plain);
  const batch = createNextState(before, (draft) => {
    for (let i = 0; i < 12; i++) tickState(draft);
  });
  expect(JSON.parse(JSON.stringify(batch))).toEqual(
    JSON.parse(JSON.stringify(plain)),
  );
  expect(
    plain.worldEvents.active.some((event) =>
      event.key.endsWith("availability-step-1"),
    ),
  ).toBe(true);
  const restored = parseSave(JSON.parse(JSON.stringify(serializeSave(plain))));
  expect(restored).not.toBeNull();
  expect(restored!.game.worldEvents).toEqual(
    JSON.parse(JSON.stringify(plain.worldEvents)),
  );
  expect(restored!.game.customScenario).toBeUndefined();
  const projection = selectProjection(
    plain,
    getTimeFromTimeline(plain.date.minute, plain.timeline)!,
  );
  const transferred: GameType = deserialize(
    serialize(forecastWorkerSnapshot(plain)),
  );
  const workerNow = getTimeFromTimeline(
    transferred.date.minute,
    transferred.timeline,
  )!;
  const workerProjection = selectProjection(transferred, workerNow);
  const { transport } = packProjection(workerProjection);
  const decoded = projectionDecoder(
    transport,
    plain,
    getTimeFromTimeline(plain.date.minute, plain.timeline)!,
  )(Infinity)!;
  expect(canonical(decoded)).toEqual(canonical(projection));
  const replay = createGameFromReplay(serializeReplay(plain)!);
  advance(replay, plain.date.minute);
  expect(replay.monthlyHistory).toEqual(plain.monthlyHistory);
  expect(replay.worldEvents).toEqual(plain.worldEvents);
  expect(replay.facilities).toEqual(plain.facilities);
});

test("missing, duplicate, forged and future official receipts reject beside an intact save", () => {
  const game = createGame({
    scenarioId: 113,
    difficulty: "Manager",
    seed: 12345,
  });
  advance(game, 36 * MINUTES_PER_MONTH);
  expect(validScenarioRuleState(game)).toBe(true);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
  const edits: ((copy: GameType) => void)[] = [
    (copy) => {
      copy.worldEvents.occurrences.pop();
    },
    (copy) => {
      copy.worldEvents.occurrences.push(
        cloneDeep(copy.worldEvents.occurrences[0]),
      );
    },
    (copy) => {
      copy.worldEvents.occurrences.at(
        -1,
      )!.effects.facilityOutputMultipliersByFuel = { Coal: 1 };
    },
    (copy) => {
      copy.worldEvents.occurrences.at(-1)!.message = "Edited outcome";
    },
    (copy) => {
      copy.worldEvents.occurrences.at(-1)!.startsMinute += MINUTES_PER_MONTH;
    },
  ];
  for (const edit of edits) {
    const forged = cloneDeep(game);
    edit(forged);
    expect(validScenarioRuleState(forged)).toBe(false);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(forged)))),
    ).toBeNull();
  }
  expect(validScenarioRuleState(game)).toBe(true);
});

test("edited active official copies cannot bypass strict save validation", () => {
  const game = createGame({
    scenarioId: 113,
    difficulty: "Manager",
    seed: 12345,
  });
  advance(game, 36 * MINUTES_PER_MONTH);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
  const edits: ((copy: GameType) => void)[] = [
    (copy) => {
      copy.worldEvents.active.find((event) =>
        event.key.endsWith("availability-step-1"),
      )!.effects.facilityOutputMultipliersByFuel = { Coal: 1 };
    },
    (copy) => {
      copy.worldEvents.active.find((event) =>
        event.key.endsWith("availability-step-1"),
      )!.message = "Forged active outcome";
    },
    (copy) => {
      copy.worldEvents.active.push(
        cloneDeep(
          copy.worldEvents.active.find((event) =>
            event.key.endsWith("availability-step-1"),
          )!,
        ),
      );
    },
  ];
  for (const edit of edits) {
    const forged = cloneDeep(game);
    edit(forged);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(forged)))),
    ).toBeNull();
    expect(validScenarioRuleState(forged)).toBe(false);
  }
  expect(validScenarioRuleState(game)).toBe(true);
});

test("rolling regional journal retention cannot discard declared official onset facts", () => {
  const game = createGame({
    scenarioId: 113,
    difficulty: "Manager",
    seed: 12345,
  });
  advance(game, 36 * MINUTES_PER_MONTH);
  const original = cloneDeep(
    game.worldEvents.occurrences.filter((event) =>
      event.key.startsWith("story:113:load-shedding:"),
    ),
  );
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
  game.worldEvents.occurrences.push(
    ...Array.from({ length: 2500 }, (_, index) => ({
      key: `regional-fixture:${index}`,
      definitionId: "regional-fixture",
      startsMinute: game.date.minute,
      endsMinute: game.date.minute,
      attributes: {},
      effects: {},
    })),
  );
  advance(game, 37 * MINUTES_PER_MONTH);
  expect(game.worldEvents.occurrences.length).toBeLessThan(2500);
  expect(
    game.worldEvents.occurrences.filter((event) =>
      event.key.startsWith("story:113:load-shedding:"),
    ),
  ).toEqual(original);
  expect(validScenarioRuleState(game)).toBe(true);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
});

test("report close captures capacity facts once and leaves history-only reliability receipts unchanged", () => {
  const game = createGame({ scenarioId: 113, seed: 12345 });
  const rules = cloneDeep(scenarioRules(getScenario(113), game)!);
  const probe = {
    ...context(game),
    rules,
    date: getDateFromMinute(84 * MINUTES_PER_MONTH, game.startingYear),
  };
  captureRuleReportObservation(game, probe);
  expect(game.worldEvents.occurrences).toEqual([]);
  rules.debriefReports = [
    { id: "capacity", kind: "firmCoverage", fromMonth: 72, throughMonth: 83 },
  ];
  const earlier = {
    ...probe,
    date: getDateFromMinute(83 * MINUTES_PER_MONTH, game.startingYear),
  };
  captureRuleReportObservation(game, earlier);
  expect(game.worldEvents.occurrences).toEqual([]);
  captureRuleReportObservation(game, probe);
  captureRuleReportObservation(game, probe);
  expect(game.worldEvents.occurrences).toHaveLength(1);
  expect(game.worldEvents.occurrences[0].attributes).toEqual({
    ruleObservation: true,
    month: 83,
    firmPeakW: probe.snapshot.firmPeakW,
    storagePeakW: probe.snapshot.storagePeakW,
    storagePeakWh: probe.snapshot.storagePeakWh,
  });
  const storage: CompiledScenarioRules = {
    ...rules,
    debriefReports: [
      {
        id: "storage",
        kind: "storageCoverage",
        fromMonth: 72,
        throughMonth: 83,
      },
    ],
  };
  const other = cloneDeep(game);
  other.worldEvents.occurrences = [];
  captureRuleReportObservation(other, { ...probe, rules: storage });
  expect(other.worldEvents.occurrences).toHaveLength(1);
});

test("the completed official review uses all twelve 2022 months and treats a missing final observation as unavailable", () => {
  const result = runSimulation({
    ...STANDARD_BALANCE_PLAYS[113],
    scenarioId: 113,
    difficulty: "CEO",
    seed: 1,
  });
  expect(result.outcome).toBe("completed");
  expect(result.violations).toEqual([]);
  expect(result.months).toHaveLength(84);
  const rules = scenarioRules(getScenario(113), {
    difficulty: "CEO",
    seed: 1,
  })!;
  const report = rules.debriefReports[0];
  const inputs = {
    startingYear: rules.startingYear,
    completedMonths: 84,
    monthlyHistory: result.months,
    occurrences: result.storyOccurrences,
  };
  const actual = interpretScenarioRuleReport(report, rules, inputs);
  expect(actual.available).toBe(true);
  expect(
    actual.metrics.map((metric) => [metric.id, metric.unit, metric.available]),
  ).toEqual([
    ["reliability", "share", true],
    ["unservedWh", "Wh", true],
  ]);
  expect(
    interpretScenarioRuleReport(report, rules, {
      ...inputs,
      monthlyHistory: result.months.slice(72),
    }),
  ).toEqual(actual);
  const missing = interpretScenarioRuleReport(report, rules, {
    ...inputs,
    monthlyHistory: result.months.slice(0, -1),
  });
  expect(missing.available).toBe(false);
  expect(missing.message).toMatch(/unavailable/i);
});
