import cloneDeep from "lodash.clonedeep";
import { GAME_TO_REAL_YEARS, TICK_MINUTES, TICKS_PER_HOUR } from "../Constants";
import { CUSTOMER_BATTERIES } from "../data/CustomerBatteries";
import { customerBatteryFleet } from "../helpers/CustomerBatteries";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "../helpers/DateTime";
import {
  applyPolicyDemand,
  emptyPolicies,
  programCustomers,
} from "../helpers/Policies";
import { serializeReplay } from "../Replay";
import { parseSave, serializeSave } from "../SaveGame";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import type { GameType, GeneratorOperatingType } from "../Types";
import { isStorage } from "../Types";
import { generateNewTimeline, tickState } from "./Game";

function fixture(minute = MINUTES_PER_MONTH + 12 * 60, scenarioId = 100) {
  const game = createGame({ scenarioId, seed: 44 });
  game.date = getDateFromMinute(minute, game.startingYear);
  game.monthlyHistory = Array.from({ length: game.date.monthsElapsed }, () =>
    summarizeTimeline(game.timeline, game.startingYear),
  );
  game.policies = emptyPolicies(game.date.monthsElapsed);
  game.policies.programs.battery = {
    tier: "On",
    adoption: 0.5,
    spending: 0,
    spent: 0,
    installs: [[1, 0.5]],
  };
  game.transmission = { lines: [], tradingPolicy: "BALANCED" };
  const source = game.timeline[0];
  game.timeline = Array.from({ length: 8 }, (_, index) => ({
    ...cloneDeep(source),
    minute: minute + index * TICK_MINUTES,
    demandW: 100,
    demandByType: {
      Residential: 100,
      Commercial: 0,
      Industrial: 0,
      Transportation: 0,
      "Data Centers": 0,
      Mining: 0,
    },
    customerBatteryWh: 0,
    customerBatteryWhStart: 0,
    customerBatteryDischargeW: 0,
    customerBatteryChargeW: 0,
    customerBatteryGridChargeW: 0,
    customerBatteryLossWh: 0,
    rooftopSurplusW: 0,
  }));
  return game;
}

function fleet(game: GameType) {
  return customerBatteryFleet(
    game.policies!.programs.battery,
    game.date.monthsElapsed,
    game.startingYear,
    programCustomers(game),
    game.location,
  );
}

function generator(game: GameType, currentW = 0, spinMinutes = 1) {
  const base = game.facilities.find(
    (facility): facility is GeneratorOperatingType => !isStorage(facility),
  )!;
  const plant: GeneratorOperatingType = {
    ...base,
    fuel: "Natural Gas",
    peakW: 300,
    currentW,
    spinMinutes,
    yearsToBuildLeft: 0,
    paused: false,
    minimumStableOutput: 0,
    tracksStarts: false,
  };
  game.facilities = [plant];
  return plant;
}

const batteryReadings = (game: GameType) =>
  game.timeline.map((tick) => ({
    minute: tick.minute,
    demandW: tick.demandW,
    demandByType: tick.demandByType,
    storedWh: tick.customerBatteryWh,
    startWh: tick.customerBatteryWhStart,
    chargedW: tick.customerBatteryChargeW,
    dischargedW: tick.customerBatteryDischargeW,
    lossWh: tick.customerBatteryLossWh,
  }));

test("fresh forecasts preserve battery energy, repeat deterministically and leave the snapshot untouched", () => {
  const game = fixture(MINUTES_PER_MONTH + 17 * 60);
  const energy = fleet(game).capacityWh * 0.8;
  game.timeline[0].customerBatteryWhStart = energy;
  game.timeline[0].customerBatteryWh = energy;
  const snapshot = cloneDeep(game);
  const forecast = () =>
    generateNewTimeline(
      game,
      game.timeline[0].cash,
      game.timeline[0].customers,
      8,
    );
  const first = forecast();
  const second = forecast();
  expect(first[0].customerBatteryWhStart).toBe(energy);
  expect(first[0].customerBatteryDischargeW).toBeGreaterThan(0);
  expect(second).toEqual(first);
  expect(game).toEqual(snapshot);

  const rebuilt = { ...cloneDeep(game), timeline: first };
  rebuilt.timeline = generateNewTimeline(
    rebuilt,
    rebuilt.timeline[0].cash,
    rebuilt.timeline[0].customers,
    8,
  );
  const energyReadings = (state: GameType) =>
    batteryReadings(state).map(
      ({ demandW: _demandW, demandByType: _demandByType, ...energy }) => energy,
    );
  expect(energyReadings(rebuilt)).toEqual(
    energyReadings({ ...game, timeline: first }),
  );
});

test("an isolated later forecast starts with the preceding tick's actual stored energy", () => {
  const game = fixture(MINUTES_PER_MONTH + 17 * 60);
  game.timeline[0].customerBatteryWhStart = fleet(game).capacityWh * 0.8;
  game.timeline = generateNewTimeline(
    game,
    game.timeline[0].cash,
    game.timeline[0].customers,
    8,
  );
  const previous = game.timeline[1];
  const next = game.timeline[2];
  game.date = getDateFromMinute(next.minute, game.startingYear);
  const forecast = generateNewTimeline(game, next.cash, next.customers, 4);
  expect(forecast[0].customerBatteryWhStart).toBe(previous.customerBatteryWh);
  expect(forecast[0].customerBatteryWh).toBe(next.customerBatteryWh);
  expect(forecast[0].customerBatteryDischargeW).toBe(
    next.customerBatteryDischargeW,
  );
});

test("Off retains battery energy across an actual month rollover and save/load", () => {
  const game = fixture(2 * MINUTES_PER_MONTH - 2 * TICK_MINUTES);
  game.policies!.programs.battery.tier = "Off";
  const energy = fleet(game).capacityWh * 0.4;
  game.timeline[0].customerBatteryWh = energy;
  game.timeline[0].customerBatteryWhStart = energy;
  tickState(game);
  tickState(game);
  expect(game.date.monthsElapsed).toBe(2);
  const current = getTimeFromTimeline(game.date.minute, game.timeline)!;
  expect(current.customerBatteryWhStart).toBe(energy);
  expect(current.customerBatteryWh).toBe(energy);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(batteryReadings(restored)).toEqual(batteryReadings(game));
  tickState(game);
  tickState(restored);
  expect(batteryReadings(restored)).toEqual(batteryReadings(game));
});

test("charging consumes already generated surplus before export and earns no retail revenue", () => {
  const enabled = fixture();
  const plant = generator(enabled, 300, 60);
  enabled.transmission!.lines = [
    {
      id: 10,
      corridorId: "california-north",
      name: "Test intertie",
      currentFlowW: 0,
      capacityW: 1000,
      buildCost: 0,
      annualOperatingCost: 0,
      yearsToBuildLeft: 0,
      minuteCreated: 0,
      financed: false,
      loanAmountLeft: 0,
      loanMonthlyPayment: 0,
      interestRate: 0,
    },
  ];
  const energy = fleet(enabled).capacityWh - 5;
  enabled.timeline[0].customerBatteryWh = energy;
  enabled.timeline[0].customerBatteryWhStart = energy;
  const disabled = cloneDeep(enabled);
  disabled.policies!.programs.battery.tier = "Off";
  tickState(enabled);
  tickState(disabled);
  const now = getTimeFromTimeline(enabled.date.minute, enabled.timeline)!;
  const without = getTimeFromTimeline(disabled.date.minute, disabled.timeline)!;
  expect(now.customerBatteryGridChargeW).toBeGreaterThan(0);
  expect(now.exportedW).toBeGreaterThan(0);
  expect(without.exportedW! - now.exportedW!).toBeCloseTo(
    now.customerBatteryGridChargeW!,
  );
  expect(plant.currentW).toBeCloseTo(
    now.supplyW + now.exportedW! + now.customerBatteryGridChargeW!,
  );
  const inputWh = now.customerBatteryGridChargeW! / TICKS_PER_HOUR;
  expect(
    now.customerBatteryWh! - energy + now.customerBatteryLossWh!,
  ).toBeCloseTo(inputWh);
  expect(now.customerBatteryWh! - energy).toBeCloseTo(
    inputWh * CUSTOMER_BATTERIES.chargeEfficiency,
  );
  const retailRevenue =
    ((now.demandW / TICKS_PER_HOUR) *
      GAME_TO_REAL_YEARS *
      now.customerBillingRate!) /
    1000;
  expect(now.revenue - now.revenueExports!).toBeCloseTo(retailRevenue);
});

test("unused dispatchable capacity cannot charge customer batteries or create electricity", () => {
  const game = fixture();
  const plant = generator(game);
  tickState(game);
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  expect(now.reserveW).toBeGreaterThan(0);
  expect(plant.currentW).toBeCloseTo(now.demandW);
  expect(now.customerBatteryGridChargeW).toBe(0);
  expect(now.customerBatteryWh).toBe(0);
});

test("rooftop electricity serves homes first and only its true surplus charges customer batteries", () => {
  const original = fixture();
  original.facilities = [];
  original.policies!.programs.solar = {
    tier: "Off",
    adoption: 1,
    spending: 0,
    spent: 0,
    installs: [[1, 1]],
    completedMonth: 1,
  };
  const probe = cloneDeep(original.timeline[1]);
  probe.solarIrradianceWM2 = 1000;
  probe.temperatureC = 25;
  probe.demandByType.Residential = 1e9;
  applyPolicyDemand(original, probe);
  const generatedW = probe.rooftopSolarW!;
  expect(generatedW).toBeGreaterThan(0);
  expect(probe.rooftopSurplusW).toBe(0);

  for (const loadShare of [1.2, 0.5]) {
    const game = cloneDeep(original);
    const tick = game.timeline[1];
    tick.solarIrradianceWM2 = 1000;
    tick.temperatureC = 25;
    tick.demandByType.Residential = generatedW * loadShare;
    applyPolicyDemand(game, tick);
    tick.demandW = Object.values(tick.demandByType).reduce(
      (sum, watts) => sum + watts,
      0,
    );
    tickState(game);
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const inputWh = now.customerBatteryChargeW! / TICKS_PER_HOUR;
    expect(now.rooftopSolarW! + now.rooftopSurplusW!).toBeCloseTo(
      generatedW,
      3,
    );
    expect(now.customerBatteryGridChargeW).toBe(0);
    expect(now.customerBatteryDischargeW).toBe(0);
    expect(now.customerBatteryWh! + now.customerBatteryLossWh!).toBeCloseTo(
      inputWh,
    );
    expect(
      now.rooftopSolarW! + now.customerBatteryChargeW!,
    ).toBeLessThanOrEqual(generatedW + 1e-6);
    expect(now.supplyW).toBe(0);
    expect(now.supplyByFuel).toEqual({});
    expect(now.rooftopSurplusW! > 0).toBe(loadShare < 1);
    expect(now.customerBatteryChargeW! > 0).toBe(loadShare < 1);
    expect(now.customerBatteryChargeW!).toBeLessThanOrEqual(
      now.rooftopSurplusW!,
    );
    expect(now.demandW > 0).toBe(loadShare > 1);
    expect(now.revenue).toBe(0);
  }
});

test("new flexibility scheduling replays with identical actual dispatch and program costs", () => {
  const game = createGame({
    scenarioId: 110,
    seed: 44,
    initialPrograms: { thermal: "On", evCharging: "On", battery: "On" },
  });
  const play = (state: GameType) => {
    const readings = [];
    while (state.date.monthsElapsed < 3) {
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline)!;
      readings.push({
        minute: now.minute,
        demandW: now.demandW,
        cash: now.cash,
        expensesPolicy: now.expensesPolicy,
        thermalShiftedW: now.thermalShiftedW ?? 0,
        evShiftedW: now.evShiftedW ?? 0,
        batteryChargeW: now.customerBatteryChargeW ?? 0,
        batteryDischargeW: now.customerBatteryDischargeW ?? 0,
        storedWh: now.customerBatteryWh ?? 0,
      });
    }
    return readings;
  };
  const actual = play(game);
  expect(actual.some((tick) => tick.expensesPolicy! > 0)).toBe(true);
  expect(actual.some((tick) => tick.thermalShiftedW > 0)).toBe(true);
  expect(actual.some((tick) => tick.evShiftedW > 0)).toBe(true);
  expect(actual.some((tick) => tick.batteryChargeW > 0)).toBe(true);
  expect(actual.some((tick) => tick.batteryDischargeW > 0)).toBe(true);
  const replay = createGameFromReplay(serializeReplay(game)!);
  expect(play(replay)).toEqual(actual);
  expect(replay.policies).toEqual(game.policies);
});

test("a historical grid cannot dispatch modern customer batteries despite a synthetic rollout record", () => {
  const game = fixture(MINUTES_PER_MONTH + 12 * 60, 102);
  generator(game, 300, 60);
  tickState(game);
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  expect(game.startingYear).toBe(1980);
  expect(now.customerBatteryGridChargeW).toBe(0);
  expect(now.customerBatteryDischargeW).toBe(0);
  expect(now.customerBatteryWh).toBe(0);
});
