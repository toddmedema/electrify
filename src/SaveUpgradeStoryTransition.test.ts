import { SAVE_SCHEMA_VERSION, upgradeSave } from "./SaveUpgrade";
import { MINUTES_PER_MONTH } from "./helpers/DateTime";

const earlier = (scenarioId: number, minute = 30 * MINUTES_PER_MONTH) => ({
  schemaVersion: 5,
  game: {
    scenarioId,
    date: { minute },
    worldEvents: {
      active: [] as unknown[],
      occurrences: [] as unknown[],
      checkedKeys: [],
    },
    monthlyHistory: [{ year: 2024, month: 6, cash: 123456, supplyWh: 98765 }],
    facilities: [{ id: 7, fuel: "Natural Gas", peakW: 12000000 }],
    cash: 123456,
  },
});

test("schema5 native111 retirement records only the actual transition instant and preserves every physical fact", () => {
  const source = {
    ...earlier(111),
    game: { ...earlier(111).game, wildfireForecastRefresh: true },
  };
  const before = JSON.stringify(source);
  const upgraded = upgradeSave(source)!;
  expect(upgraded.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  expect(upgraded.game).toEqual({
    ...source.game,
    scenarioRuleHistoryStartMinute: source.game.date.minute,
  });
  expect(upgradeSave(upgraded)).toEqual(upgraded);
  expect(JSON.stringify(source)).toBe(before);
  const withLegacyAccess = {
    ...earlier(111),
    game: { ...earlier(111).game, legacyWildfireIntertieAccess: true },
  };
  expect(upgradeSave(withLegacyAccess)!.game).toEqual({
    ...withLegacyAccess.game,
    scenarioRuleHistoryStartMinute: withLegacyAccess.game.date.minute,
    wildfireForecastRefresh: true,
  });
});

test("only genuinely pre-story native101 empty evidence receives a history boundary", () => {
  const source = earlier(101, 185 * MINUTES_PER_MONTH + 1000);
  expect(upgradeSave(source)!.game).toEqual({
    ...source.game,
    scenarioRuleHistoryStartMinute: source.game.date.minute,
  });
  for (const change of [
    { objectiveProgress: {} },
    {
      worldEvents: {
        ...source.game.worldEvents,
        occurrences: [{ key: "existing" }],
      },
    },
    {
      worldEvents: {
        ...source.game.worldEvents,
        active: [{ key: "existing" }],
      },
    },
  ]) {
    expect(
      upgradeSave({ ...source, game: { ...source.game, ...change } })!.game,
    ).toEqual({ ...source.game, ...change });
  }
});

test("migration never fabricates current-schema boundaries or grants another namespace an exemption", () => {
  const source = earlier(101);
  expect(
    upgradeSave({ ...source, schemaVersion: SAVE_SCHEMA_VERSION }),
  ).toEqual({ ...source, schemaVersion: SAVE_SCHEMA_VERSION });
  for (const scenarioId of [100, 106, 107, 999]) {
    const source = earlier(scenarioId);
    expect(upgradeSave(source)!.game).toEqual(source.game);
  }
  for (const customScenario of [{}, { mod: {} }]) {
    const source = earlier(111);
    const game = {
      ...source.game,
      wildfireForecastRefresh: true,
      customScenario,
    };
    expect(upgradeSave({ ...source, game })!.game).toEqual(game);
  }
  const missingProvenance = earlier(111);
  expect(upgradeSave(missingProvenance)!.game).toEqual(missingProvenance.game);
});

test("earlier schemas cannot supply a future history exemption", () => {
  for (const schemaVersion of [0, 1, 2, 3, 4, 5]) {
    const source = earlier(101);
    expect(
      upgradeSave({
        ...source,
        schemaVersion,
        game: {
          ...source.game,
          scenarioRuleHistoryStartMinute: source.game.date.minute,
        },
      }),
    ).toBeNull();
  }
});

test.each([-1, 0, 1])(
  "the first new-source opening checks the exact readiness boundary %i",
  (offset) => {
    const source = earlier(111, 25 * MINUTES_PER_MONTH + offset);
    const game = { ...source.game, wildfireForecastRefresh: true };
    expect(upgradeSave({ ...source, game })!.game).toEqual({
      ...game,
      ...(offset < 0
        ? {}
        : { scenarioRuleHistoryStartMinute: game.date.minute }),
    });
  },
);

test("invalid instants and already recorded new-source phases do not create migration boundaries", () => {
  for (const minute of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const source = earlier(111, minute);
    const game = { ...source.game, wildfireForecastRefresh: true };
    expect(upgradeSave({ ...source, game })!.game).toEqual(game);
  }
  const source = earlier(111);
  const game = {
    ...source.game,
    wildfireForecastRefresh: true,
    worldEvents: {
      ...source.game.worldEvents,
      occurrences: [{ key: "story:111:wildfire-intertie:readiness" }],
    },
  };
  expect(upgradeSave({ ...source, game })!.game).toEqual(game);
  const beforeOpening = earlier(111, 24 * MINUTES_PER_MONTH);
  expect(
    upgradeSave({
      ...beforeOpening,
      game: { ...beforeOpening.game, wildfireForecastRefresh: true },
    })!.game,
  ).toEqual({ ...beforeOpening.game, wildfireForecastRefresh: true });
});
