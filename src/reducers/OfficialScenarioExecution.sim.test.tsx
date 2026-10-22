import { createHash } from "crypto";
import { deserialize, serialize } from "v8";
import { createNextState } from "@reduxjs/toolkit";
import { TICK_MINUTES, TICK_MS } from "../Constants";
import { forecastWorkerSnapshot } from "../components/base/ForecastWorkerSnapshot";
import {
  packProjection,
  projectionDecoder,
} from "../components/base/ProjectionTransport";
import { accessContextForGame } from "../data/IntertieAccess";
import { getScenario } from "../data/Scenarios";
import { resolveStoryAtDate } from "../data/WorldEvents";
import type { CompiledScenarioRules } from "../data/ScenarioRules";
import { MINUTES_PER_MONTH, getTimeFromTimeline } from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { selectProjection } from "../helpers/Projection";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { ruleEffectsForOccurrence } from "../helpers/ScenarioRuleRuntime";
import {
  scenarioRules,
  validCompiledScenarioRules,
} from "../helpers/ScenarioRules";
import { buildStorySnapshot } from "../helpers/Story";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { serializeReplay } from "../Replay";
import { parseSave, serializeSave } from "../SaveGame";
import { getStore } from "../StoreRegistry";
import {
  OFFICIAL_EXECUTION_IDS,
  copyOfficialGame,
  officialCommand,
  officialQuote,
  playOfficialExecution,
} from "../testing/OfficialScenarioExecutionFixtures";
import { createGameFromReplay } from "../testing/Simulator";
import type { GameType } from "../Types";
import {
  buildFacility,
  loaded,
  quit,
  resume,
  sellFacility,
  setSpeed,
  tick,
  tickState,
  togglePauseFacility,
} from "./Game";

jest.setTimeout(120000);
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  getStore().dispatch(quit());
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
function canonical(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? Number(value.toPrecision(10))
      : String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function physical(game: GameType) {
  return {
    scenarioId: game.scenarioId,
    seed: game.seed,
    difficulty: game.difficulty,
    startingYear: game.startingYear,
    date: game.date,
    location: game.location,
    facilities: game.facilities,
    transmission: game.transmission,
    loadAdditions: game.loadAdditions,
    monthlyHistory: game.monthlyHistory,
    worldEvents: game.worldEvents,
    objectiveProgress: game.objectiveProgress,
    currentFrame: currentTick(game),
    dollarsPerkWh: game.dollarsPerkWh,
    customerMarketSize: game.customerMarketSize,
    policies: game.policies,
  };
}
function expectSamePhysical(
  actual: GameType,
  expected: GameType,
  label: string,
  savedQuotes = false,
) {
  const original = physical(expected);
  // Certified on the old engine: JSON turns only these cached renewable quote Infinity values
  // into null. They never enter dispatch. All remaining facility and simulation fields stay exact.
  const target = savedQuotes
    ? {
        ...original,
        facilities: original.facilities.map((facility) =>
          ["Wind", "Sun"].includes(facility.fuel ?? "") &&
          facility.lcWh === Infinity
            ? { ...facility, lcWh: null }
            : facility,
        ),
      }
    : original;
  const received = physical(actual);
  for (const key of Object.keys(target) as (keyof typeof target)[])
    expect({ label, field: key, value: canonical(received[key]) }).toEqual({
      label,
      field: key,
      value: canonical(target[key]),
    });
}
function expectSavedQuoteCells(actual: GameType, original: GameType) {
  expect(
    actual.facilities
      .filter((facility) => Reflect.get(facility, "lcWh") === null)
      .map((facility) => facility.id)
      .sort(),
  ).toEqual(
    original.facilities
      .filter(
        (facility) =>
          ["Wind", "Sun"].includes(facility.fuel ?? "") &&
          facility.lcWh === Infinity,
      )
      .map((facility) => facility.id)
      .sort(),
  );
}
function expectSave(game: GameType, label: string) {
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  const restored = parseSave(raw);
  expect({ label, valid: restored !== null }).toEqual({ label, valid: true });
  expect(restored!.game.scenarioId).toBe(game.scenarioId);
  expect(restored!.game.customScenario).toBeUndefined();
  expect(pendingScenarioChoice(restored!.game)?.id).toBe(
    pendingScenarioChoice(game)?.id,
  );
  expectSavedQuoteCells(restored!.game, game);
  expectSamePhysical(restored!.game, game, `${label} decoded`, true);
  if (game.date.monthsElapsed >= getScenario(game.scenarioId)!.durationMonths)
    return;
  const original = copyOfficialGame(game),
    resumed = copyOfficialGame(restored!.game);
  for (let index = 0; index < 2; index++) {
    tickState(original);
    tickState(resumed);
  }
  expectSavedQuoteCells(resumed, original);
  expectSamePhysical(resumed, original, `${label} continued`, true);
}
function expectReplay(game: GameType, label: string) {
  const recorded = serializeReplay(game);
  expect(recorded).toBeDefined();
  expect(recorded!.scenarioId).toBe(game.scenarioId);
  expect(recorded!.customScenario).toBeUndefined();
  const replay = createGameFromReplay(recorded!);
  while (replay.date.minute < game.date.minute) tickState(replay);
  expectSamePhysical(replay, game, label);
}
function expectWorker(game: GameType, label: string) {
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const direct = selectProjection(game, now);
  const transferred: GameType = deserialize(
    serialize(forecastWorkerSnapshot(game)),
  );
  const workerNow = getTimeFromTimeline(
    transferred.date.minute,
    transferred.timeline,
  )!;
  const projected = selectProjection(transferred, workerNow);
  const { transport } = packProjection(projected);
  const decoded = projectionDecoder(transport, game, now)(Infinity)!;
  expect({ label, actual: digest(decoded) }).toEqual({
    label,
    actual: digest(direct),
  });
  expect(transferred.scenarioId).toBe(game.scenarioId);
  expect(transferred.customScenario).toBeUndefined();
}
function expectPlainAndImmer(game: GameType, label: string) {
  const before = digest(physical(game));
  const plain = copyOfficialGame(game);
  for (let index = 0; index < 12; index++) tickState(plain);
  const immer = createNextState(game, (draft) => {
    for (let index = 0; index < 12; index++) tickState(draft);
  });
  expectSamePhysical(immer, plain, label);
  expect(digest(physical(game))).toBe(before);
}
function expectPresentationBatch(game: GameType, steps: number, label: string) {
  let wallClockMs = 0;
  const clock = jest
    .spyOn(performance, "now")
    .mockImplementation(() => wallClockMs);
  try {
    getStore().dispatch(quit());
    getStore().dispatch(tick());
    getStore().dispatch(resume(game));
    getStore().dispatch(loaded());
    getStore().dispatch(setSpeed("ULTRA"));
    const before = getStore().getState().game;
    const expected = copyOfficialGame(before);
    for (let index = 0; index < steps; index++) {
      tickState(expected);
      if (!expected.inGame || expected.speed === "PAUSED") break;
    }
    wallClockMs = steps * TICK_MS.ULTRA;
    getStore().dispatch(tick());
    const actual = getStore().getState().game;
    expectSamePhysical(actual, expected, label);
    expect(actual.date.minute).toBeGreaterThan(before.date.minute);
    expect(actual.date.minute - before.date.minute).toBeLessThanOrEqual(
      steps * TICK_MINUTES,
    );
  } finally {
    getStore().dispatch(quit());
    clock.mockRestore();
  }
}

function expectOpeningDiscount(
  game: GameType,
  rules: CompiledScenarioRules,
): boolean {
  if (game.date.minute !== 0 || game.scenarioId !== 101) return false;
  const event = rules.events.find((item) => item.id === "bridge-contracts")!;
  const build = {
    name: "Natural Gas CC",
    peakW: 600e6,
    financed: true,
  };
  const ordinary = officialQuote(
    { ...game, storyEffectsDisabled: true },
    build,
  );
  const discounted = officialQuote(game, build);
  expect(discounted.buildCost).toBeCloseTo(
    ordinary.buildCost *
      event.effects.buildCostMultipliersByFuel!["Natural Gas"]!,
    5,
  );
  expect(
    game.facilities.find((item) => item.name === build.name)!.buildCost,
  ).toBe(discounted.buildCost);
  expect(
    game.worldEvents.occurrences.some((receipt) => receipt.key === event.key),
  ).toBe(false);
  return true;
}

test.each(OFFICIAL_EXECUTION_IDS)(
  "normalized native %i rules validate through the shared frozen-snapshot guard",
  (scenarioId) => {
    const rules = scenarioRules(getScenario(scenarioId), {
      difficulty: "CEO",
      seed: 12345,
    })!;
    expect(validCompiledScenarioRules(rules)).toBe(true);
  },
);

for (const scenarioId of OFFICIAL_EXECUTION_IDS)
  test(`official ${scenarioId} reaches native save/replay/worker and live batch boundaries with a legal full campaign`, () => {
    const scenario = getScenario(scenarioId)!;
    const rules = scenarioRules(scenario, { difficulty: "CEO", seed: 12345 })!;
    const physicalEvents = rules.events.filter(
      (event) =>
        event.durationMonths > 0 &&
        (Object.keys(event.effects).length > 0 || event.targets.length > 0),
    );
    const firstPhysical = Math.min(
      ...physicalEvents
        .filter((event) => event.startMonth > 0)
        .map((event) => event.startMonth),
    );
    const critical = Number.isFinite(firstPhysical)
      ? firstPhysical
      : Math.min(...rules.arcChoices!.map((choice) => choice.dueMonth));
    expect(Number.isFinite(critical)).toBe(true);
    const firstExpiry = Math.min(
      ...physicalEvents.map((event) =>
        Math.min(
          scenario.durationMonths,
          event.startMonth + event.durationMonths,
        ),
      ),
    );
    const saves = new Set([critical, firstExpiry, scenario.durationMonths]);
    const reached = new Set<string>();
    const result = playOfficialExecution(scenarioId, {
      beforeTick(game, nextMinute) {
        if (expectOpeningDiscount(game, rules))
          reached.add("month-zero-discount-without-receipt");
        if (nextMinute !== critical * MINUTES_PER_MONTH) return;
        expectWorker(game, `${scenarioId} before onset`);
        expectPlainAndImmer(game, `${scenarioId} plain/Immer`);
        for (const steps of [12, 120])
          expectPresentationBatch(
            game,
            steps,
            `${scenarioId} ${steps}-step batch`,
          );
        reached.add("worker/plain/Immer/12/120");
      },
      monthClose(game) {
        if (!saves.has(game.date.monthsElapsed)) return;
        expectSave(game, `${scenarioId} month ${game.date.monthsElapsed}`);
        reached.add(`save:${game.date.monthsElapsed}`);
        if (game.date.monthsElapsed !== critical) return;
        expectReplay(game, `${scenarioId} reached-onset replay`);
        reached.add("replay");
      },
      choice(game, phase, id) {
        expectSave(game, `${scenarioId} ${phase} ${id}`);
        reached.add(`${phase}:${id}`);
        if (phase !== "answered") return;
        expectReplay(game, `${scenarioId} answered ${id} replay`);
      },
    });
    const game = result.game;
    expect(result.violations).toEqual([]);
    expect(game.monthlyHistory).toHaveLength(scenario.durationMonths);
    expect(game.date.monthsElapsed).toBe(scenario.durationMonths);
    expect(game.customScenario).toBeUndefined();
    expect(accessContextForGame(game).scenarioId).toBe(scenarioId);
    expect(
      gameObjectiveResults(game).every(
        (goal) => !goal.required || goal.status === "completed",
      ),
    ).toBe(true);
    expect(reached.has("worker/plain/Immer/12/120")).toBe(true);
    expect(reached.has("replay")).toBe(true);
    expect(
      [...reached].filter((label) => label.startsWith("save:")).sort(),
    ).toEqual(
      [...saves]
        .filter(Number.isFinite)
        .map((month) => `save:${month}`)
        .sort(),
    );
    for (const event of rules.events)
      expect(
        game.worldEvents.occurrences.filter(
          (receipt) => receipt.key === event.key,
        ),
      ).toHaveLength(
        scenarioId === 101 && event.id === "bridge-contracts" ? 0 : 1,
      );
    expect(reached.has("month-zero-discount-without-receipt")).toBe(
      scenarioId === 101,
    );
    const expectedChoices = rules.arcChoices!;
    expect(
      [...reached].filter((label) => label.startsWith("pending:")).sort(),
    ).toEqual(expectedChoices.map((choice) => `pending:${choice.key}`).sort());
    expect(
      [...reached].filter((label) => label.startsWith("answered:")).sort(),
    ).toEqual(expectedChoices.map((choice) => `answered:${choice.key}`).sort());
  });

function nativeContext(game: GameType) {
  return {
    rules: scenarioRules(getScenario(game.scenarioId), game)!,
    scenarioId: game.scenarioId,
    seed: game.seed,
    difficulty: game.difficulty,
    date: game.date,
    location: game.location,
    occurrences: game.worldEvents.occurrences,
    snapshot: buildStorySnapshot(
      game.monthlyHistory,
      game.facilities,
      game.date.minute,
    ),
  };
}
function expectNoStaleTarget(game: GameType, key: string, id: number) {
  const recorded = game.worldEvents.occurrences.find(
    (event) => event.key === key,
  )!;
  const effects = ruleEffectsForOccurrence(recorded, nativeContext(game));
  expect(effects.facilityOutputMultipliersById?.[String(id)]).toBeUndefined();
  tickState(game);
  expect(
    resolveStoryAtDate(nativeContext(game)).effects
      .facilityOutputMultipliersById?.[String(id)],
  ).toBeUndefined();
  expectSave(game, `${game.scenarioId} sold-target neighbor`);
}
function replaceThroughCommands(game: GameType, targetId: number) {
  let current = copyOfficialGame(game);
  for (const id of current.facilities
    .filter((item) => item.id >= targetId)
    .map((item) => item.id))
    current = officialCommand(current, sellFacility(id));
  const plan = { name: "Natural Gas Peaker", peakW: 10e6, financed: true };
  current = officialCommand(
    current,
    buildFacility({ facility: officialQuote(current, plan), financed: true }),
  );
  expect(current.facilities).toContainEqual(
    expect.objectContaining({ id: targetId, minuteCreated: game.date.minute }),
  );
  expect(
    current.facilities.find((item) => item.id === targetId)!.startingAssetId,
  ).toBeUndefined();
  return current;
}

test("the real native nuclear outage keeps a paused original and ignores sold or same-ID replacement assets", () => {
  const scenarioId = 110;
  const rules = scenarioRules(getScenario(scenarioId), {
    difficulty: "CEO",
    seed: 12345,
  })!;
  const event = rules.events.find((item) => item.id === "trip")!;
  let before: GameType | undefined;
  const { game: onset } = playOfficialExecution(scenarioId, {
    throughMonth: event.startMonth,
    beforeTick(game, nextMinute) {
      if (nextMinute === event.startMonth * MINUTES_PER_MONTH)
        before = copyOfficialGame(game);
    },
  });
  const original = before!.facilities.find(
    (item) => item.startingAssetId === "scenario-110-grand-nuclear-unit",
  )!;
  const paused = officialCommand(before!, togglePauseFacility(original.id));
  tickState(paused);
  expect(
    resolveStoryAtDate(nativeContext(paused)).effects
      .facilityOutputMultipliersById?.[String(original.id)],
  ).toBe(0);
  const sold = officialCommand(before!, sellFacility(original.id));
  tickState(sold);
  expectNoStaleTarget(sold, event.key, original.id);
  const replaced = replaceThroughCommands(onset, original.id);
  expectNoStaleTarget(replaced, event.key, original.id);
  expect(
    resolveStoryAtDate(nativeContext(onset)).effects
      .facilityOutputMultipliersById?.[String(original.id)],
  ).toBe(0);
});

test.each([104, 111])(
  "native %i storm targets never transfer to a plant bought on the same onset boundary",
  (scenarioId) => {
    const rules = scenarioRules(getScenario(scenarioId), {
      difficulty: "CEO",
      seed: 12345,
    })!;
    const event = rules.events.find((item) => item.targets.length > 0)!;
    const { game: onset } = playOfficialExecution(scenarioId, {
      throughMonth: event.startMonth,
    });
    const recorded = onset.worldEvents.occurrences.find(
      (item) => item.key === event.key,
    )!;
    const ids = recorded.attributes.selectedFacilityIds as number[];
    expect(ids.length).toBeGreaterThan(0);
    const id = Math.max(...ids);
    const replaced = replaceThroughCommands(onset, id);
    expectNoStaleTarget(replaced, event.key, id);
    expect(
      onset.worldEvents.occurrences.find((item) => item.key === event.key),
    ).toEqual(recorded);
    expect(
      resolveStoryAtDate(nativeContext(onset)).effects
        .facilityOutputMultipliersById?.[String(id)],
    ).toBeLessThan(1);
  },
);

test("native report receipts reject forged payment markers without changing the intact neighboring run", () => {
  const rules = scenarioRules(getScenario(104), {
    difficulty: "CEO",
    seed: 12345,
  })!;
  const event = rules.events.find((item) => item.id === "landfall")!;
  const { game } = playOfficialExecution(104, {
    throughMonth: event.startMonth,
  });
  const unchanged = digest(physical(game));
  expect(validScenarioRuleState(game)).toBe(true);
  expectSave(game, "intact native review receipt");
  for (const attributes of [
    { ruleEvent: true },
    { upfrontGrant: 1000000000 },
    { cost: 1 },
    { ruleEvent: true, upfrontGrant: 1000000000, cost: 0 },
  ]) {
    const forged = copyOfficialGame(game);
    const recorded = forged.worldEvents.occurrences.find(
      (receipt) => receipt.key === event.key,
    )!;
    Object.assign(recorded.attributes, attributes);
    // Matching both copies ensures this checks the receipt owner, not an unrelated active-copy mismatch.
    const active = forged.worldEvents.active.find(
      (receipt) => receipt.key === event.key,
    )!;
    active.attributes = { ...recorded.attributes };
    expect(validScenarioRuleState(forged)).toBe(false);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(forged)))),
    ).toBeNull();
  }
  expect(digest(physical(game))).toBe(unchanged);
  expect(validScenarioRuleState(game)).toBe(true);
  expectSave(game, "unchanged native review neighbor");
});

test("the native restoration review rejects a forged reportAvailable flag beside its intact saved neighbor", () => {
  const rules = scenarioRules(getScenario(104), {
    difficulty: "CEO",
    seed: 12345,
  })!;
  const event = rules.events.find((item) => item.id === "restoration")!;
  const { game } = playOfficialExecution(104, {
    throughMonth: event.startMonth,
  });
  const unchanged = digest(physical(game));
  const original = game.worldEvents.occurrences.find(
    (receipt) => receipt.key === event.key,
  )!;
  expect(original.attributes.reportAvailable).toBeUndefined();
  expect(original.attributes.reliability).toBeGreaterThan(0);
  expect(validScenarioRuleState(game)).toBe(true);
  expectSave(game, "intact restoration review");
  const forged = copyOfficialGame(game);
  for (const receipt of [
    ...forged.worldEvents.occurrences,
    ...forged.worldEvents.active,
  ])
    if (receipt.key === event.key) receipt.attributes.reportAvailable = true;
  expect(validScenarioRuleState(forged)).toBe(false);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(forged)))),
  ).toBeNull();
  expect(digest(physical(game))).toBe(unchanged);
  expect(validScenarioRuleState(game)).toBe(true);
  expectSave(game, "unchanged restoration review neighbor");
});

test("the native aging warning rejects malformed or duplicate selected IDs beside its real saved neighbor", () => {
  const rules = scenarioRules(getScenario(102), {
    difficulty: "CEO",
    seed: 12345,
  })!;
  const warning = rules.events.find((event) => event.id === "aging-warning")!;
  const { game } = playOfficialExecution(102, {
    throughMonth: warning.startMonth,
  });
  const unchanged = digest(physical(game));
  const original = game.worldEvents.occurrences.find(
    (event) => event.key === warning.key,
  )!;
  // This legal route has sold the qualifying old coal plant; its empty warning receipt stays valid.
  expect(original.attributes.selectedFacilityIds).toEqual([]);
  expect(original.attributes.selectedFacilityNames).toEqual([]);
  expect(validScenarioRuleState(game)).toBe(true);
  expectSave(game, "intact aging warning");
  for (const ids of [
    "1",
    [1, 1],
    [-1],
    [1.5],
    [NaN],
    [Infinity],
    [Number.MAX_SAFE_INTEGER + 1],
  ]) {
    const forged = copyOfficialGame(game);
    for (const event of [
      ...forged.worldEvents.occurrences,
      ...forged.worldEvents.active,
    ])
      if (event.key === warning.key) event.attributes.selectedFacilityIds = ids;
    expect(validScenarioRuleState(forged)).toBe(false);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(forged)))),
    ).toBeNull();
  }
  expect(digest(physical(game))).toBe(unchanged);
  expect(validScenarioRuleState(game)).toBe(true);
  expectSave(game, "unchanged aging warning neighbor");
});
