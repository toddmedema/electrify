import { encodeSave } from "./SaveEncoding";
import { parseSave, serializeSave } from "./SaveGame";
import { isFutureSave, SAVE_SCHEMA_VERSION } from "./SaveSchema";
import { FIRST_SUPPORTED_SAVE_SCHEMA, upgradeSave } from "./SaveUpgrade";
import { createGame } from "./testing/Simulator";
import gameReducer, {
  delta,
  loaded,
  resume,
  start,
  tickState,
} from "./reducers/Game";
import { createNextState } from "@reduxjs/toolkit";
import { TICK_MINUTES } from "./Constants";
import type { GameType } from "./Types";

jest.setTimeout(60000);

const legacyRules = [
  ["BALANCED", "SHORTAGES", "SURPLUS"],
  ["RELIABILITY_FIRST", "SHORTAGES", "NONE"],
  ["SURPLUS_ONLY", "NONE", "SURPLUS"],
  ["CLOSED", "NONE", "NONE"],
] as const;

let game: GameType;
beforeAll(() => {
  game = createGame({ scenarioId: 100, seed: 61 });
});

function legacySave(schemaVersion = 7, tradingPolicy: unknown = "BALANCED") {
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = schemaVersion;
  const {
    buyingRule: _buying,
    sellingRule: _selling,
    ...transmission
  } = raw.game.transmission;
  raw.game.transmission = { ...transmission, tradingPolicy };
  return raw;
}

it.each(legacyRules)(
  "keeps %s trading permissions while migrating a decoded or packed save",
  (tradingPolicy, buyingRule, sellingRule) => {
    for (const packed of [false, true]) {
      const raw = legacySave(7, tradingPolicy);
      const payload = packed ? encodeSave(raw) : raw;
      const original = JSON.stringify(payload);
      const migrated = parseSave(payload);
      expect(migrated?.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(migrated?.game.transmission).toEqual({
        lines: game.transmission!.lines,
        buyingRule,
        sellingRule,
      });
      expect(migrated?.game.date).toEqual(game.date);
      expect(migrated?.game.timeline[0].cash).toEqual(game.timeline[0].cash);
      expect(migrated?.game.policies).toEqual(game.policies);
      expect(migrated?.game.facilities).toEqual(game.facilities);
      expect(JSON.stringify(payload)).toBe(original);
      expect(parseSave(migrated)).toEqual(migrated);
    }
  },
);

it("runs each required step and retires replay data without changing recorded progress", () => {
  const raw = legacySave(6);
  raw.game.replayLog = [
    { minute: 0, type: "setTradingPolicy", payload: "BALANCED" },
  ];
  raw.game.replayPlayback = { actions: [], index: 0 };
  const original = JSON.stringify(raw);
  const migrated = parseSave(raw);
  expect(migrated).not.toBeNull();
  expect(migrated!.game).not.toHaveProperty("replayLog");
  expect(migrated!.game).not.toHaveProperty("replayPlayback");
  expect(migrated!.game.monthlyHistory).toEqual(raw.game.monthlyHistory);
  expect(migrated!.game.meaningfulDecisions).toEqual(
    raw.game.meaningfulDecisions,
  );
  expect(migrated!.game.transmission?.buyingRule).toBe("SHORTAGES");
  expect(JSON.stringify(raw)).toBe(original);
});

it.each([undefined, null, "BALANCED ", "constructor", "__proto__", 0, {}])(
  "rejects corrupt legacy trading permission %p instead of defaulting it",
  (policy) => {
    const raw = legacySave(7, policy);
    // Passing undefined through a default parameter would otherwise choose BALANCED.
    raw.game.transmission.tradingPolicy = policy;
    const original = JSON.stringify(raw);
    expect(parseSave(raw)).toBeNull();
    expect(JSON.stringify(raw)).toBe(original);
  },
);

it("does not repair current or hybrid trading records or unrelated damaged progress", () => {
  const current = legacySave(SAVE_SCHEMA_VERSION);
  expect(parseSave(current)).toBeNull();
  const hybrid = legacySave();
  hybrid.game.transmission.buyingRule = "SHORTAGES";
  expect(parseSave(hybrid)).toBeNull();
  const corrupt = legacySave(6);
  corrupt.game.facilities[0].peakW = "bad";
  expect(parseSave(corrupt)).toBeNull();
});

it.each([
  undefined,
  null,
  -1,
  1.5,
  "7",
  FIRST_SUPPORTED_SAVE_SCHEMA - 1,
  SAVE_SCHEMA_VERSION + 1,
])(
  "rejects unsupported schema %p before migrating anything",
  (schemaVersion) => {
    const raw = { ...legacySave(), schemaVersion };
    expect(upgradeSave(raw)).toBeNull();
    expect(parseSave(raw)).toBeNull();
    expect(isFutureSave(raw)).toBe(schemaVersion === SAVE_SCHEMA_VERSION + 1);
  },
);

it("migrates a grid without regional transmission", () => {
  const solo = createGame({ scenarioId: 105, seed: 31337 });
  const raw = JSON.parse(JSON.stringify(serializeSave(solo)));
  raw.schemaVersion = 6;
  if (raw.game.transmission) {
    raw.game.transmission = {
      lines: raw.game.transmission.lines,
      tradingPolicy: "BALANCED",
    };
  }
  expect(solo.transmission).toBeUndefined();
  expect(parseSave(raw)?.game).toEqual(
    parseSave(JSON.parse(JSON.stringify(serializeSave(solo))))?.game,
  );
});

it("advances migrated progress through the real simulation without changing its next month", () => {
  const played = createGame({ scenarioId: 100, seed: 61 });
  while (played.date.monthsElapsed < 1) tickState(played);
  const raw = JSON.parse(JSON.stringify(serializeSave(played)));
  raw.schemaVersion = 7;
  const {
    buyingRule: _buying,
    sellingRule: _selling,
    ...transmission
  } = raw.game.transmission;
  raw.game.transmission = { ...transmission, tradingPolicy: "BALANCED" };
  const migrated = parseSave(encodeSave(raw));
  const current = parseSave(serializeSave(played));
  expect(migrated).not.toBeNull();
  expect(current).not.toBeNull();
  while (migrated!.game.date.monthsElapsed < 2) tickState(migrated!.game);
  while (current!.game.date.monthsElapsed < 2) tickState(current!.game);
  expect(migrated!.game).toEqual(current!.game);
  expect(parseSave(serializeSave(migrated!.game))).not.toBeNull();
});

it("starts a new game without inheriting a continued run's forecast-refresh marker", () => {
  const continued = { ...game, rulesChanged: true, runIdentity: undefined };
  const fresh = gameReducer(continued, start(101));
  expect(fresh.rulesChanged).toBeUndefined();
});

it("keeps the forecast-refresh marker through generic gameplay updates", () => {
  const continued = { ...game, rulesChanged: true, runIdentity: undefined };
  const updated = gameReducer(
    continued,
    delta({ rulesChanged: false, dollarsPerkWh: 0.12 }),
  );
  expect(updated.rulesChanged).toBe(true);
  expect(updated.dollarsPerkWh).toBe(0.12);
});

it("refreshes changed-rule future forecasts on resume while preserving recorded progress", () => {
  jest.useFakeTimers();
  try {
    const played = createGame({ scenarioId: 101, seed: 31337 });
    while (played.date.monthsElapsed < 1) tickState(played);
    tickState(played);
    const raw = JSON.parse(JSON.stringify(serializeSave(played)));
    raw.game.runIdentity.compatibilityId = `rules-1-${"0".repeat(64)}`;
    const current = raw.game.timeline.find(
      (t: { minute: number }) => t.minute === played.date.minute,
    );
    current.deferredResidential = [
      {
        energyWh: 3_000_000,
        recoveryStartMinute: played.date.minute + TICK_MINUTES,
        recoveryEndMinute: played.date.minute + TICK_MINUTES + 180,
      },
    ];
    current.deferredResidentialWh = 3_000_000;
    const reference = JSON.parse(JSON.stringify(raw));
    const originalNext = reference.game.timeline.find(
      (t: { minute: number }) => t.minute > played.date.minute,
    );
    for (const future of raw.game.timeline) {
      if (future.minute > played.date.minute) {
        future.demandW *= 2;
        future.windKph = 12345;
        future.Coal *= 2;
        future.supplyW *= 2;
      }
    }
    const continued = parseSave(raw)!;
    expect(continued).not.toBeNull();
    const recorded = JSON.stringify(
      continued.game.timeline.filter((t) => t.minute <= played.date.minute),
    );
    const history = JSON.stringify(continued.game.monthlyHistory);
    const restored = gameReducer(
      gameReducer(undefined, resume(continued.game)),
      loaded(),
    );
    const next = restored.timeline.find((t) => t.minute > played.date.minute)!;
    const expected = gameReducer(
      gameReducer(undefined, resume(parseSave(reference)!.game)),
      loaded(),
    );
    const expectedNext = expected.timeline.find(
      (t) => t.minute > played.date.minute,
    )!;
    expect(next.demandW).toBe(expectedNext.demandW);
    expect(next.windKph).toBe(expectedNext.windKph);
    expect(next.Coal).toBe(expectedNext.Coal);
    expect(next.windKph).toBe(originalNext.windKph);
    expect(next.Coal).toBe(originalNext.Coal);
    expect(restored.timeline).toEqual(expected.timeline);
    expect(next.supplyW).toBe(expectedNext.supplyW);
    expect(next.supplyByFuel).toEqual(expectedNext.supplyByFuel);
    expect(next.cash).toBe(expectedNext.cash);
    expect(next.deferredResidentialStart).toEqual(current.deferredResidential);
    expect(
      JSON.stringify(
        restored.timeline.filter((t) => t.minute <= played.date.minute),
      ),
    ).toBe(recorded);
    expect(JSON.stringify(restored.monthlyHistory)).toBe(history);
    expect(restored.facilities).toEqual(continued.game.facilities);
    expect(restored.policies).toEqual(continued.game.policies);
    const persisted = parseSave(
      JSON.parse(JSON.stringify(serializeSave(restored))),
    )!;
    const repeated = gameReducer(
      gameReducer(undefined, resume(persisted.game)),
      loaded(),
    );
    expect(serializeSave(repeated).commitmentForecast).toEqual(
      serializeSave(restored).commitmentForecast,
    );
    expect(repeated.timeline).toEqual(restored.timeline);
    const advanced = createNextState(restored, (state) => {
      tickState(state);
    });
    const advancedAgain = createNextState(repeated, (state) => {
      tickState(state);
    });
    expect(advanced.timeline).toEqual(advancedAgain.timeline);
    expect(advanced.monthlyHistory).toEqual(advancedAgain.monthlyHistory);
    expect(advanced.rulesChanged).toBe(true);
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
