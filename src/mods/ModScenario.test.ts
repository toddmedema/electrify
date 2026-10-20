import { createNextState as produce } from "@reduxjs/toolkit";
import { matchScenario } from "../multiplayer/World";
import { validBrowseState } from "../multiplayer/Browse";
import { quit, tickState } from "../reducers/Game";
import { TICKS_PER_MONTH } from "../Constants";
import { TextEncoder } from "util";
import { modIssue, modScenario } from "./ModScenario";
import { MOD_API_VERSION, ModPackage, validateMod } from "./ModSchema";
import { createGame } from "../testing/Simulator";
import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../data/Scenarios";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { inEraMoney } from "../data/FuelPrices";
import { inEraRate } from "../data/RetailRates";
import { standardCustomRate } from "../helpers/CustomScenarioEvents";
import { policyTotalCost } from "../helpers/Policies";
import { serializeSave, parseSave } from "../SaveGame";
import { getStore } from "../StoreRegistry";
import { startAchievements } from "../desktop/AchievementObserver";
import * as User from "../reducers/User";
import type { GameType } from "../Types";
Object.assign(global, { TextEncoder });
const fixture = (): ModPackage => ({
  schemaVersion: 1,
  gameApi: MOD_API_VERSION,
  id: "test-grid",
  title: "Test Grid",
  creator: "Creator",
  version: "1",
  seed: 42,
  baseScenarioId: 999,
  facilities: {
    Solar: { buildCost: 0.5 },
    Battery: { annualOperatingCost: 2 },
  },
  programs: { efficiency: 0.5 },
});

test("valid content resolves to a detached scenario carrying only its runtime effects", () => {
  const pack = fixture();
  const scenario = modScenario(pack, "123");
  expect(scenario.id).toBe(999);
  expect(scenario.seed).toBe(42);
  expect(scenario.mod).toEqual({
    source: {
      id: "test-grid",
      title: "Test Grid",
      creator: "Creator",
      version: "1",
      workshopId: "123",
    },
    facilities: pack.facilities,
    programs: pack.programs,
  });
  expect(scenario).not.toHaveProperty("modPackage");
  pack.facilities!.Solar!.buildCost = 9;
  expect(scenario.mod!.facilities!.Solar!.buildCost).toBe(0.5);
  expect(modIssue({ ...fixture(), gameApi: MOD_API_VERSION + 1 })).toBe(
    "Made for a different game version. Ask Creator for an update.",
  );
  expect(modIssue(fixture())).toBeUndefined();
  expect(() => modScenario({ ...fixture(), baseScenarioId: 998 })).toThrow(
    /baseScenarioId is not a scenario/,
  );
  expect(() =>
    modScenario({ ...fixture(), scenario: { eventScenarioIds: [998] } }),
  ).toThrow();
  expect(() => validateMod({ ...fixture(), engineScript: "bad" })).toThrow(
    /engineScript is not a supported field/,
  );
});

test("notifications after the resolved scenario end are rejected", () => {
  const notice = { month: 13, title: "Late", message: "Too late." };
  expect(() =>
    modScenario({
      ...fixture(),
      scenario: { durationMonths: 12 },
      notifications: [notice],
    }),
  ).toThrow("notifications[0].month is after the scenario ends (month 12).");
  expect(() =>
    modScenario({
      ...fixture(),
      scenario: { durationMonths: 13 },
      notifications: [notice],
    }),
  ).not.toThrow();
});

test("money the author left unset follows a changed starting year", () => {
  const custom = modScenario({
    ...fixture(),
    scenario: { startingYear: 2060 },
  });
  expect(custom.cash).toBe(
    inEraMoney(DEFAULT_CUSTOM_SCENARIO.cash, 2060, 2020),
  );
  expect(custom.cash).not.toBe(DEFAULT_CUSTOM_SCENARIO.cash);
  expect(custom.dollarsPerkWh).toBe(
    standardCustomRate({ ...DEFAULT_CUSTOM_SCENARIO, startingYear: 2060 }),
  );
  const base = SCENARIOS.find((s) => s.id === 114)!;
  const authored = modScenario({
    ...fixture(),
    baseScenarioId: 114,
    scenario: { startingYear: 1980 },
  });
  expect(authored.cash).toBe(inEraMoney(base.cash, 1980, base.startingYear));
  expect(authored.dollarsPerkWh).toBe(
    inEraRate(base.dollarsPerkWh, 1980, base.startingYear),
  );
  expect(authored.dollarsPerkWh).not.toBe(base.dollarsPerkWh);
  expect(authored.feePerKgCO2e).toBe(
    inEraMoney(base.feePerKgCO2e, 1980, base.startingYear),
  );
  const unchanged = modScenario({ ...fixture(), baseScenarioId: 114 });
  expect(unchanged.cash).toBe(base.cash);
  expect(unchanged.dollarsPerkWh).toBe(base.dollarsPerkWh);
  const explicit = modScenario({
    ...fixture(),
    scenario: { startingYear: 2060, cash: 5, dollarsPerkWh: 0.2 },
  });
  expect(explicit.cash).toBe(5);
  expect(explicit.dollarsPerkWh).toBe(0.2);
});

test("mod event selection carries its future demand into the chosen era without replacing author prices or duration", () => {
  const scenario = modScenario({
    ...fixture(),
    scenario: {
      startingYear: 2040,
      eventScenarioIds: [106],
      dollarsPerkWh: 0.3,
      durationMonths: 72,
    },
  });
  expect(scenario.loadAdditions).toEqual([
    expect.objectContaining({ label: "Data Centers", startsYear: 2046 }),
  ]);
  expect(scenario.dollarsPerkWh).toBe(0.3);
  expect(scenario.durationMonths).toBe(72);
});

test("base scenario existing industrial loads remain present when the era changes", () => {
  const scenario = modScenario({
    ...fixture(),
    baseScenarioId: 114,
    scenario: { startingYear: 2040 },
  });
  expect(scenario.reliabilityObjective).toEqual(
    expect.objectContaining({ year: 2044, month: 1 }),
  );
  expect(scenario.loadAdditions).toEqual([
    expect.objectContaining({
      label: "Copperbelt mines",
      startsYear: 2040,
      peakW: 65000000,
    }),
  ]);
});

const regularGame = () =>
  createGame({
    scenarioId: 999,
    scenario: { ...DEFAULT_CUSTOM_SCENARIO },
    seed: 42,
    difficulty: "Manager",
  });
const moddedGame = (pack = fixture()) =>
  createGame({
    scenarioId: 999,
    scenario: modScenario(pack),
    seed: 42,
    difficulty: "Manager",
  });

test("facility and program modifiers are run-local and survive save loading", () => {
  const regular = regularGame();
  const modded = moddedGame();
  const solar = (game: GameType) =>
    GENERATORS(game, 1e8, [10], [100]).find((g) => g.name === "Solar")!;
  expect(solar(modded).buildCost).toBe(solar(regular).buildCost * 0.5);
  expect(STORAGE(modded, 1e8)[0].annualOperatingCost).toBe(
    STORAGE(regular, 1e8)[0].annualOperatingCost * 2,
  );
  expect(policyTotalCost(modded, "efficiency", 1)).toBe(
    policyTotalCost(regular, "efficiency", 1) * 0.5,
  );
  expect(modded.runIdentity).toBeUndefined();
  const save = serializeSave(modded);
  const restored = parseSave(JSON.parse(JSON.stringify(save)));
  expect(restored?.game.customScenario?.mod).toEqual(
    modded.customScenario!.mod,
  );
  expect(solar(restored!.game).buildCost).toBe(solar(modded).buildCost);
  const invalid = JSON.parse(JSON.stringify(save));
  invalid.game.customScenario.mod.programs.solar = -1;
  expect(parseSave(invalid)).toBeNull();
});

test("modded saves stay loadable when the catalog or authoring schema later changes", () => {
  const save = JSON.parse(JSON.stringify(serializeSave(moddedGame())));
  // A facility a future build retired, and a field the authoring schema would now reject.
  save.game.customScenario.mod.facilities["Retired Plant"] = { buildCost: 2 };
  save.game.customScenario.mod.programs.retiredProgram = 2;
  save.game.customScenario.mod.source.title = "x".repeat(500);
  const restored = parseSave(save);
  expect(restored).not.toBeNull();
  expect(
    GENERATORS(restored!.game, 1e8, [10], [100]).find(
      (g) => g.name === "Solar",
    )!.buildCost,
  ).toBe(
    GENERATORS(moddedGame(), 1e8, [10], [100]).find((g) => g.name === "Solar")!
      .buildCost,
  );
  const wrongId = JSON.parse(JSON.stringify(save));
  wrongId.game.customScenario.id = 100;
  expect(parseSave(wrongId)).toBeNull();
});

test("mod notifications are committed once and survive save loading", () => {
  const game = moddedGame({
    ...fixture(),
    notifications: [
      { month: 1, title: "Review grid", message: "Check the first month." },
    ],
  });
  for (let i = 0; i < TICKS_PER_MONTH; i++) tickState(game);
  expect(
    game.eventLog.filter((event) => event.title === "Review grid"),
  ).toHaveLength(1);
  const restored = parseSave(JSON.parse(JSON.stringify(serializeSave(game))))!;
  expect(restored.game.reportedEventKeys).toContain("mod-notice:0");
  for (let i = 0; i < 4; i++) tickState(restored.game);
  expect(
    restored.game.eventLog.filter((event) => event.title === "Review grid"),
  ).toHaveLength(1);
});

test("a modded run that reaches its end is unranked, submits no score and earns no achievements", () => {
  jest.useFakeTimers();
  const submit = jest.spyOn(User, "submitHighscore");
  try {
    getStore().dispatch(quit());
    let game = moddedGame({ ...fixture(), scenario: { durationMonths: 6 } });
    while (game.date.monthsElapsed < 6)
      game = produce(game, (draft: GameType) => {
        tickState(draft);
      });
    jest.runOnlyPendingTimers();
    const victory = getStore().getState().ui.victory;
    expect(victory).toEqual(
      expect.objectContaining({
        scenarioName: "Test Grid",
        ranked: false,
        modded: true,
      }),
    );
    expect(submit).not.toHaveBeenCalled();
  } finally {
    submit.mockRestore();
    jest.useRealTimers();
  }
  const submitAchievements = jest.fn(async () => {});
  const state = {
    game: {
      customScenario: modScenario(fixture()),
      desktopAchievements: { earned: ["FIRST_SPARK"] },
    },
    saves: { transitioning: false },
  };
  const stop = startAchievements(
    {
      getState: () => state as never,
      subscribe: () => () => {},
    },
    { submitAchievements } as never,
  );
  stop();
  expect(submitAchievements).not.toHaveBeenCalled();
});

test("mod runs cannot enter co-op through custom setup or the wire", () => {
  const regular = {
    scenarioId: 999,
    difficulty: "Manager" as const,
    customScenario: { ...DEFAULT_CUSTOM_SCENARIO },
  };
  expect(matchScenario(regular).scenario.id).toBe(999);
  const customScenario = modScenario(fixture());
  expect(() => matchScenario({ ...regular, customScenario })).toThrow();
  const browse = {
    session: "test",
    revision: 0,
    phase: "browsing",
    card: "CUSTOM_GAME",
    difficulty: "Manager",
    custom: regular.customScenario,
  };
  expect(validBrowseState(browse)).toBe(true);
  expect(validBrowseState({ ...browse, custom: customScenario })).toBe(false);
});
