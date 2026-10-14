import cloneDeep from "lodash.clonedeep";
import { createNextState as produce } from "@reduxjs/toolkit";
import catalog from "./AchievementCatalog.json";
import {
  achievementHooks as hooks,
  OFFICIAL_IDS,
  reliable,
  validAchievementProgress,
} from "./Achievements";
import { installSimulationHooks } from "./SimulationHooks";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { SCENARIOS } from "../data/Scenarios";
import { STORAGE } from "../data/Facilities";
import gameReducer, { togglePauseFacility, tickState } from "../reducers/Game";
import {
  EMPTY_HISTORY,
  getDateFromMinute,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { startingDollarRevenue } from "../helpers/Scoring";
import { parseSave, serializeSave } from "../SaveGame";
import { GAME_TO_REAL_YEARS, TICKS_PER_HOUR } from "../Constants";
import type {
  GameType,
  MonthlyHistoryType,
  StorageOperatingType,
  TickPresentFutureType,
} from "../Types";

const month = (
  patch: Partial<MonthlyHistoryType> = {},
): MonthlyHistoryType => ({
  ...EMPTY_HISTORY,
  year: 2010,
  month: 1,
  supplyWh: 1e9,
  demandWh: 1e9,
  deliveredWhByFuel: {},
  ...patch,
});
function game(id = 101): GameType {
  return cloneDeep(
    createGame({
      scenarioId: id,
      seed: SCENARIOS.find((s) => s.id === id)?.seed ?? 17,
    }),
  );
}
function finished(patch: Partial<MonthlyHistoryType> = {}, id = 101): GameType {
  const state = game(id);
  const duration = SCENARIOS.find(
    ({ id: candidate }) => candidate === id,
  )!.durationMonths!;
  state.monthlyHistory = Array.from({ length: duration }, () => month(patch));
  state.date = getDateFromMinute(
    duration * MINUTES_PER_MONTH,
    state.startingYear,
  );
  return state;
}
const earned = (state: GameType) => state.desktopAchievements!.earned;
beforeAll(() => installSimulationHooks(hooks));
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("catalog pins all 35 IDs and the 14 official non-tutorial scenarios", () => {
  expect(catalog).toHaveLength(35);
  expect(new Set(catalog.map(({ id }) => id)).size).toBe(35);
  expect([...OFFICIAL_IDS].sort()).toEqual(
    SCENARIOS.filter((s) => !s.tutorialSteps)
      .map(({ id }) => id)
      .sort(),
  );
});
test.each(OFFICIAL_IDS)(
  "scenario %i unlocks solely on a successful full-duration finish, including CEO",
  (id) => {
    const state = finished({ supplyWh: 1, kgco2e: 1e12 }, id);
    const scenarioAchievement = catalog.find(
      (entry) => entry.scenarioId === id,
    )!.id;
    for (const difficulty of [
      "Intern",
      "Employee",
      "Manager",
      "VP",
      "CEO",
    ] as const) {
      state.difficulty = difficulty;
      state.desktopAchievements!.earned = [];
      hooks.finish(state, "completed");
      expect(earned(state)).toContain(scenarioAchievement);
      expect(earned(state)).toContain("STAYING_POWER");
      expect(earned(state)).not.toContain("OUT_OF_JUICE");
      expect(earned(state).includes("CHIEF_ELECTRICITY_OFFICER")).toBe(
        difficulty === "CEO",
      );
      expect(state.desktopAchievements!.completion).toEqual({
        scenarioId: id,
        difficulty,
      });
    }
  },
);
test("bankruptcy unlocks once in every official scenario and difficulty without recording a win", () => {
  for (const id of OFFICIAL_IDS) {
    const state = game(id);
    for (const difficulty of [
      "Intern",
      "Employee",
      "Manager",
      "VP",
      "CEO",
    ] as const) {
      state.difficulty = difficulty;
      state.desktopAchievements!.earned = [];
      hooks.finish(state, "bankrupt");
      hooks.finish(state, "bankrupt");
      expect(earned(state)).toEqual(["OUT_OF_JUICE"]);
      expect(state.desktopAchievements!.completion).toBeUndefined();
    }
  }
});
test("tutorials, custom runs, simulation harness overrides and replays cannot earn bankruptcy", () => {
  const tutorial = game(0);
  hooks.finish(tutorial, "bankrupt");
  expect(earned(tutorial)).toEqual([]);
  for (const patch of [
    { customScenario: SCENARIOS[0] },
    { replayPlayback: {} as GameType["replayPlayback"] },
    { meaningfulDecisionGateWaived: true },
    { storyEffectsDisabled: true },
    { weatherHazardsDisabled: true },
    { wildfireHazardDisabled: true },
  ]) {
    const state = Object.assign(game(), patch);
    hooks.finish(state, "bankrupt");
    expect(earned(state)).toEqual([]);
    expect(state.desktopAchievements!.completion).toBeUndefined();
  }
});
test("a committed bankruptcy earns Out of Juice and preserves it in a save", () => {
  const state = game();
  state.timeline[0].cash = -1e12;
  runMonths(state, 1);
  expect(state.monthlyHistory[0].cash).toBeLessThan(0);
  expect(earned(state)).toEqual(["OUT_OF_JUICE"]);
  expect(state.desktopAchievements!.completion).toBeUndefined();
  const restored = parseSave(serializeSave(state))!.game;
  expect(earned(restored)).toEqual(["OUT_OF_JUICE"]);
  expect(restored.desktopAchievements!.completion).toBeUndefined();
});
test("firing, shortened runs, custom runs, simulation harness overrides and replays cannot earn successful finish achievements", () => {
  const fired = finished();
  hooks.finish(fired, "fired");
  expect(earned(fired)).toEqual([]);
  for (const patch of [
    { monthlyHistory: [month()] },
    { customScenario: SCENARIOS[0] },
    { replayPlayback: {} as GameType["replayPlayback"] },
    { meaningfulDecisionGateWaived: true },
  ]) {
    const state = Object.assign(finished(), patch);
    hooks.finish(state, "completed");
    expect(earned(state)).toEqual([]);
  }
});
test("an official successful finish does not require a shareable/ranked run identity", () => {
  const state = finished();
  state.runIdentity = undefined;
  hooks.finish(state, "completed");
  expect(earned(state)).toContain("A_BRIGHTER_FUTURE");
});
test("First Spark uses the actual final tutorial step; other tutorials report distinct completions", () => {
  for (const id of [0, 1, 2, 4, 3, 5, 112]) {
    const state = game(id);
    const length = SCENARIOS.find((s) => s.id === id)!.tutorialSteps!.length;
    state.tutorialStep = length - 1;
    hooks.tutorial(state);
    expect(state.desktopAchievements!.completion).toBeUndefined();
    state.tutorialStep = length;
    hooks.tutorial(state);
    expect(state.desktopAchievements!.completion?.scenarioId).toBe(id);
    expect(earned(state).includes("FIRST_SPARK")).toBe(id === 0);
    expect(earned(state)).not.toContain("STAYING_POWER");
  }
  const state = game(0);
  state.tutorialStep = 999;
  state.replayPlayback = {} as GameType["replayPlayback"];
  hooks.tutorial(state);
  expect(earned(state)).toEqual([]);
});
test("reliability requires positive demand and includes exactly 99.9%", () => {
  expect(reliable(month({ demandWh: 0, supplyWh: 0 }))).toBe(false);
  expect(reliable(month({ supplyWh: 999e6 }))).toBe(true);
  expect(reliable(month({ supplyWh: 998999999 }))).toBe(false);
});
test("Lights On resets on an unreliable month and unlocks at the twelfth close", () => {
  const state = game();
  state.monthlyHistory = [month()];
  for (let i = 0; i < 11; i++) hooks.month(state, true);
  expect(earned(state)).not.toContain("LIGHTS_ON");
  state.monthlyHistory = [month({ supplyWh: 998e6 })];
  hooks.month(state, true);
  state.monthlyHistory = [month()];
  for (let i = 0; i < 12; i++) hooks.month(state, true);
  expect(earned(state)).toContain("LIGHTS_ON");
});
test("recovery requires the next three consecutive reliable months and a continuing run", () => {
  for (const continuing of [false, true]) {
    const state = game();
    state.monthlyHistory = [month({ supplyWh: 989e6 })];
    hooks.month(state, true);
    state.monthlyHistory = [month()];
    hooks.month(state, true);
    hooks.month(state, true);
    expect(earned(state)).not.toContain("BACK_ON_THE_GRID");
    hooks.month(state, continuing);
    expect(earned(state).includes("BACK_ON_THE_GRID")).toBe(continuing);
  }
  const state = game();
  state.monthlyHistory = [month({ supplyWh: 989e6 })];
  hooks.month(state, true);
  state.monthlyHistory = [month({ supplyWh: 998e6 })];
  hooks.month(state, true);
  state.monthlyHistory = [month()];
  for (let i = 0; i < 3; i++) hooks.month(state, true);
  expect(earned(state)).not.toContain("BACK_ON_THE_GRID");
});
test.each([
  [999900000, true],
  [999899999, false],
])("Four Nines uses lifetime demand at %i Wh", (supplyWh, qualifies) => {
  const state = finished({ supplyWh });
  hooks.finish(state, "completed");
  expect(earned(state).includes("FOUR_NINES")).toBe(qualifies);
});
test.each([
  [100000, true],
  [100001, false],
])(
  "Clean Finish includes total construction/import emissions at %i kg",
  (kgco2e, qualifies) => {
    const state = finished({
      kgco2e,
      localKgco2e: 0,
      importedKgco2e: 50000,
      constructionKgco2e: kgco2e - 50000,
    });
    hooks.finish(state, "completed");
    expect(earned(state).includes("CLEAN_FINISH")).toBe(qualifies);
  },
);
test("Half the Carbon compares first/final energy-weighted years, with positive baseline and reliable final months", () => {
  const state = finished({ kgco2e: 100000 });
  state.monthlyHistory.slice(-12).forEach((m) => {
    m.kgco2e = 200000;
  });
  hooks.finish(state, "completed");
  expect(earned(state)).toContain("HALF_THE_CARBON");
  state.desktopAchievements!.earned = [];
  state.monthlyHistory[0].kgco2e++;
  hooks.finish(state, "completed");
  expect(earned(state)).not.toContain("HALF_THE_CARBON");
  state.monthlyHistory.forEach((m) => {
    m.kgco2e = 0;
  });
  hooks.finish(state, "completed");
  expect(earned(state)).not.toContain("HALF_THE_CARBON");
});
test("finish fuel shares use customer-delivered domain fuels, and coal requires a coal starting plant", () => {
  const state = finished({
    deliveredWhByFuel: {
      Sun: 5e8,
      Wind: 2e8,
      "Offshore Wind": 2e8,
      "Airborne Wind": 1e8,
    },
  });
  state.desktopAchievements!.startedWithCoal = true;
  hooks.finish(state, "completed");
  expect(earned(state)).toEqual(
    expect.arrayContaining([
      "COALS_LAST_SHIFT",
      "HERE_COMES_THE_SUN",
      "WINDS_OF_CHANGE",
      "STRENGTH_IN_DIVERSITY",
    ]),
  );
  state.desktopAchievements!.earned = [];
  state.desktopAchievements!.startedWithCoal = false;
  state.monthlyHistory.forEach((m) => {
    m.deliveredWhByFuel = { Sun: 499999999, "Natural Gas": 1e8, Uranium: 1e8 };
  });
  hooks.finish(state, "completed");
  for (const id of [
    "COALS_LAST_SHIFT",
    "HERE_COMES_THE_SUN",
    "WINDS_OF_CHANGE",
    "STRENGTH_IN_DIVERSITY",
  ])
    expect(earned(state)).not.toContain(id);
});
test("every final-year month must be reliable, independent of the window's aggregate", () => {
  const state = finished({ deliveredWhByFuel: { Sun: 1e9 } });
  state.monthlyHistory[0].supplyWh = 998e6;
  hooks.finish(state, "completed");
  expect(earned(state)).not.toContain("HERE_COMES_THE_SUN");
  expect(earned(state)).not.toContain("CLEAN_FINISH");
});
test("Public utility rate uses inflation-aware customer revenue and excludes grants/exports", () => {
  const scenario = SCENARIOS.find(
    (s) => !s.tutorialSteps && s.ownership === "Public",
  )!;
  const state = finished({}, scenario.id);
  state.monthlyHistory.forEach((m) => {
    m.revenue = 1e12;
    m.revenueGrants = 1e12;
  });
  expect(
    startingDollarRevenue(state.monthlyHistory, state.startingYear, state.seed),
  ).toBe(0);
  hooks.finish(state, "completed");
  expect(earned(state)).toContain("POWER_TO_THE_PEOPLE");
  state.desktopAchievements!.earned = [];
  state.monthlyHistory.forEach((m) => {
    m.revenueGrants = 0;
  });
  hooks.finish(state, "completed");
  expect(earned(state)).not.toContain("POWER_TO_THE_PEOPLE");
});

function tickFixture(id = 101): {
  state: GameType;
  tick: TickPresentFutureType;
  battery: StorageOperatingType;
} {
  const state = game(id);
  const battery: StorageOperatingType = {
    ...STORAGE(state, 1e9)[0],
    id: 999,
    currentW: 40,
    currentWh: 1e9,
    yearsToBuildLeft: 0,
    minuteCreated: 15,
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    lifetimeWh: 0,
    lifetimePotentialWh: 0,
    lifetimeRevenue: 0,
    lifetimeExpenses: 0,
  };
  state.facilities.push(battery);
  state.date = getDateFromMinute(18 * 60 + 15, state.startingYear);
  const tick = {
    ...state.timeline[0],
    demandW: 100,
    supplyW: 100,
    supplyByFuel: { "Natural Gas": 100 },
    storageDischargeW: 40,
    importedW: 60,
    exportedW: 20,
    rebateEligibleW: 100,
    efficiencySavedW: 10,
  };
  return { state, tick, battery };
}
test("night storage counts player-built discharge accepted by customers, with gross-source allocation", () => {
  const { state, tick, battery } = tickFixture();
  hooks.tick(state, tick);
  const weight = GAME_TO_REAL_YEARS / TICKS_PER_HOUR;
  expect(state.desktopAchievements!.month.nightStorageWh).toBeCloseTo(
    20 * weight,
  );
  expect(state.desktopAchievements!.month.nightServedWh).toBeCloseTo(
    100 * weight,
  );
  const once = cloneDeep(state.desktopAchievements);
  hooks.tick(state, tick);
  expect(state.desktopAchievements).toEqual(once);
  battery.currentW = -40;
  state.date.minute += 15;
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.nightStorageWh).toBeCloseTo(
    20 * weight,
  );
});
test("evening storage excludes inherited assets and respects the 18:00-to-midnight interval", () => {
  const { state, tick, battery } = tickFixture();
  hooks.initialize(state);
  state.date = getDateFromMinute(18 * 60 + 30, state.startingYear);
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.nightStorageWh).toBe(0);
  battery.minuteCreated++;
  state.date = getDateFromMinute(MINUTES_PER_MONTH - 15, state.startingYear);
  hooks.tick(state, tick);
  const evening = state.desktopAchievements!.month.nightStorageWh;
  expect(evening).toBeGreaterThan(0);
  state.date = getDateFromMinute(MINUTES_PER_MONTH, state.startingYear);
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.nightStorageWh).toBe(evening);
  state.date = getDateFromMinute(MINUTES_PER_MONTH + 15, state.startingYear);
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.nightStorageWh).toBe(evening);
});
test("imports require a commissioned player-built intertie, not a construction order or inherited line", () => {
  const { state, tick } = tickFixture();
  const line = {
    id: 1,
    corridorId: "test",
    name: "Test",
    capacityW: 100,
    buildCost: 1,
    annualOperatingCost: 0,
    yearsToBuildLeft: 1,
    minuteCreated: 15,
    financed: false,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    currentFlowW: 60,
  };
  state.transmission = { tradingPolicy: "BALANCED", lines: [line] };
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.importedWh).toBe(0);
  hooks.initialize(state);
  line.yearsToBuildLeft = 0;
  state.date.minute += 15;
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.importedWh).toBe(0);
  line.minuteCreated++;
  state.date.minute += 15;
  hooks.tick(state, tick);
  expect(state.desktopAchievements!.month.importedWh).toBeCloseTo(
    (30 * GAME_TO_REAL_YEARS) / TICKS_PER_HOUR,
  );
  expect(state.desktopAchievements!.commissionedIntertie).toBe(true);
});
test.each([
  [25, true],
  [24.999, false],
])(
  "monthly storage, trade and efficiency awards use inclusive thresholds %f",
  (storageShare, qualifies) => {
    const state = game();
    state.date.monthsElapsed = 1;
    state.monthlyHistory = [month()];
    state.desktopAchievements!.month = {
      nightServedWh: 100,
      nightStorageWh: storageShare,
      importedWh: 1e8,
      exportedWh: 1e8,
      eligibleWh: 100,
      efficiencyWh: 10,
    };
    hooks.month(state, true);
    expect(earned(state).includes("NIGHT_SHIFT")).toBe(qualifies);
    expect(earned(state)).toEqual(
      expect.arrayContaining([
        "GRID_CONNECTED",
        "GOOD_NEIGHBOR",
        "A_WATT_SAVED",
      ]),
    );
  },
);
test("a legacy partial month and an unreliable month cannot unlock monthly counter achievements", () => {
  for (const legacy of [false, true]) {
    const state = game();
    state.date.monthsElapsed = 1;
    state.monthlyHistory = [month({ supplyWh: legacy ? 1e9 : 998e6 })];
    if (legacy) state.desktopAchievements!.counterStartMonth = 1;
    state.desktopAchievements!.month = {
      nightServedWh: 100,
      nightStorageWh: 100,
      importedWh: 1e9,
      exportedWh: 1e9,
      eligibleWh: 100,
      efficiencyWh: 100,
    };
    hooks.month(state, true);
    expect(earned(state)).toEqual([]);
  }
});
test("retrofit output starts only at actual completion, and new plants/reused IDs cannot inherit it", () => {
  const { state, tick } = tickFixture(107);
  const generator = state.facilities.find((f) => f.fuel === "Natural Gas")!;
  generator.currentW = 3e8;
  hooks.tick(state, tick);
  expect(earned(state)).not.toContain("WASTE_NOT");
  hooks.converted(state, generator.id);
  state.date.minute += 15;
  hooks.tick(state, {
    ...tick,
    supplyByFuel: { "Natural Gas": 3e8 },
    storageDischargeW: 0,
    importedW: 0,
    demandW: 3e8,
    supplyW: 3e8,
  });
  expect(earned(state)).toContain("WASTE_NOT");
  state.desktopAchievements!.earned = [];
  generator.minuteCreated++;
  state.date.minute += 15;
  hooks.tick(state, tick);
  expect(earned(state)).not.toContain("WASTE_NOT");
});
test("saved telemetry survives resume, forecasts and frozen optimized live ticks", () => {
  let state = game();
  runMonths(state, 1);
  expect(validAchievementProgress(state.desktopAchievements)).toBe(true);
  const restored = parseSave(serializeSave(state))!.game;
  expect(restored.desktopAchievements).toEqual(state.desktopAchievements);
  const before = cloneDeep(state.desktopAchievements);
  state = gameReducer(state, togglePauseFacility(state.facilities[0].id));
  expect(state.desktopAchievements).toEqual(before);
  state = produce(state, (draft) => {
    tickState(draft);
  });
  expect(state.desktopAchievements!.lastMinute).toBe(state.date.minute);
  const resumed = cloneDeep(restored);
  runMonths(resumed, 1);
  expect(resumed.desktopAchievements!.lastMinute).toBe(resumed.date.minute);
});
test("telemetry validation rejects malformed imported counters and unknown awards", () => {
  const state = game();
  for (const patch of [
    { earned: ["UNKNOWN"] },
    { month: {} },
    { lastMinute: NaN },
    { convertedWh: { bad: 1 } },
    { completion: { scenarioId: -1, difficulty: "CEO" } },
  ]) {
    const invalid = { ...state.desktopAchievements!, ...patch };
    expect(validAchievementProgress(invalid)).toBe(false);
    expect(
      parseSave(
        serializeSave({
          ...state,
          desktopAchievements: invalid as GameType["desktopAchievements"],
        }),
      ),
    ).toBeNull();
  }
});
