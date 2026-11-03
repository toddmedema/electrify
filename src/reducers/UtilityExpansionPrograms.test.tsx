import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH, TICK_MINUTES, YEARS_PER_TICK } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { POLICIES } from "../data/Policies";
import { UTILITY_TARGETS } from "../data/UtilityExpansion";
import { customerBatteryFleet } from "../helpers/CustomerBatteries";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { programCustomers } from "../helpers/Policies";
import { previewPolicy } from "../helpers/PolicyPreview";
import { parseSave, serializeSave } from "../SaveGame";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import { runMonths } from "../testing/SimulationTestHelpers";
import { createGame } from "../testing/Simulator";
import type { GameType, UtilityTargetId } from "../Types";
import reducer, {
  buildFacility,
  buildTransmissionLine,
  delta,
  generateForecastTimeline,
  tickState,
} from "./Game";
import { acquireUtility, schedulePolicy } from "./GameActions";

function preparedCompany(): GameType {
  let game = createGame({ scenarioId: 116, difficulty: "Intern", seed: 12345 });
  currentTick(game)!.cash = 3e9;
  const gas = GENERATORS(game, 250e6, [], []).find(
    (plant) => plant.name === "Natural Gas CC",
  )!;
  game = copyOfficialGame(
    reducer(game, buildFacility({ facility: gas, financed: false })),
  );
  // Construction timing has separate coverage; this fixture supplies a durable backup portfolio.
  game.facilities.find(
    (plant) => plant.yearsToBuildLeft > 0,
  )!.yearsToBuildLeft = YEARS_PER_TICK / 2;
  return game;
}
function connection(game: GameType, targetId: UtilityTargetId): GameType {
  const corridorId = UTILITY_TARGETS.find(
    (target) => target.id === targetId,
  )!.corridorId;
  const connected = copyOfficialGame(
    reducer(game, buildTransmissionLine({ corridorId, financed: false })),
  );
  connected.transmission!.lines.find(
    (line) => line.corridorId === corridorId,
  )!.yearsToBuildLeft = 0;
  return connected;
}
function buy(game: GameType, targetId: UtilityTargetId): GameType {
  const quote = acquisitionQuote(game, targetId)!;
  expect(quote).toBeDefined();
  return copyOfficialGame(
    reducer(
      game,
      acquireUtility({ targetId, financed: true, quoteKey: quote.quoteKey }),
    ),
  );
}

it("enlarging one company preserves installed efficiency and reopens its unfinished rollout", () => {
  let game = connection(preparedCompany(), "valley-electric");
  game = copyOfficialGame(
    reducer(game, schedulePolicy({ id: "efficiency", tier: "On", month: 1 })),
  );
  runMonths(game, POLICIES.efficiency.buildoutMonths);
  expect(game.policies!.programs.efficiency.adoption).toBe(1);
  const original = cloneDeep(game.policies!.programs.efficiency);
  const originalEligible = programCustomers(game);
  const savedW = currentTick(game)!.efficiencySavedW;
  game = buy(game, "valley-electric");
  const merged = game.policies!.programs.efficiency;
  const eligible = programCustomers(game);
  expect(merged.adoption).toBeLessThan(1);
  expect(merged.adoption * eligible).toBeCloseTo(
    original.adoption * originalEligible,
    6,
  );
  expect(merged.completedMonth).toBeUndefined();
  expect(merged.spent).toBe(original.spent);
  expect(merged.spending).toBe(original.spending);
  expect(currentTick(game)!.efficiencySavedW).toBe(savedW);
  expect(merged.installs).toHaveLength(original.installs!.length);
  merged.installs!.forEach(([month, share], index) => {
    expect(month).toBe(original.installs![index][0]);
    expect(share * eligible).toBeCloseTo(
      original.installs![index][1] * originalEligible,
      6,
    );
  });
  game = copyOfficialGame(
    reducer(
      game,
      schedulePolicy({
        id: "efficiency",
        tier: "Off",
        month: game.date.monthsElapsed + 1,
      }),
    ),
  );
  expect(game.policies!.programs.efficiency.pending?.tier).toBe("Off");
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
  const paused = cloneDeep(game.policies!.programs.efficiency);
  runMonths(game, 1);
  expect(game.policies!.programs.efficiency.installs).toEqual(paused.installs);
  expect(game.policies!.programs.efficiency.spent).toBe(original.spent);
  game = copyOfficialGame(
    reducer(
      game,
      schedulePolicy({
        id: "efficiency",
        tier: "On",
        month: game.date.monthsElapsed + 1,
      }),
    ),
  );
  runMonths(game, 1);
  expect(game.policies!.programs.efficiency.adoption).toBeGreaterThan(
    paused.adoption,
  );
  expect(game.policies!.programs.efficiency.spent).toBeGreaterThan(
    original.spent,
  );
});

it("policy previews apply the same company-wide choice as the owning action", () => {
  const game = buy(
    connection(preparedCompany(), "ridge-electric"),
    "ridge-electric",
  );
  const before = JSON.stringify(game);
  const change = {
    id: "timeOfUse",
    tier: "On",
    month: 1,
    startHour: 18,
  } as const;
  const preview = previewPolicy(game, change, 1);
  const scheduled = copyOfficialGame(reducer(game, schedulePolicy(change)));
  const now = currentTick(game)!;
  const forecast = generateForecastTimeline(
    scheduled,
    now.cash,
    now.customers,
    2 * TICKS_PER_MONTH,
  );
  expect(preview.changed).toEqual(
    forecast.slice(TICKS_PER_MONTH).map((tick) => tick.demandW),
  );
  expect(JSON.stringify(game)).toBe(before);
});

it("a purchase preserves one installed battery fleet, stored energy and demand queues through month rollover", () => {
  let game = buy(
    connection(preparedCompany(), "ridge-electric"),
    "ridge-electric",
  );
  runMonths(game, 132);
  for (const policy of [
    { id: "battery", tier: "On", month: 133, startHour: 17 },
    { id: "timeOfUse", tier: "On", month: 133, startHour: 21 },
  ] as const)
    game = copyOfficialGame(reducer(game, schedulePolicy(policy)));
  runMonths(game, 1);
  expect(game.policies!.programs.battery.adoption).toBeGreaterThan(0);
  game = copyOfficialGame(
    reducer(game, schedulePolicy({ id: "battery", tier: "Off", month: 134 })),
  );
  runMonths(game, 1);
  while (game.date.minuteOfDay < 22 * 60) tickState(game);
  const fleet = () =>
    customerBatteryFleet(
      game.policies!.programs.battery,
      game.date.monthsElapsed,
      game.startingYear,
      programCustomers(game),
      game.location,
    );
  const capacity = fleet().capacityWh;
  expect(capacity).toBeGreaterThan(0);
  currentTick(game)!.customerBatteryWh = capacity / 2;
  currentTick(game)!.customerBatteryWhStart = capacity / 2;
  game = connection(game, "valley-electric");
  game = copyOfficialGame(reducer(game, delta({ dollarsPerkWh: 0.2 })));
  const before = cloneDeep(currentTick(game)!);
  const policies = cloneDeep(game.policies!);
  expect(before.deferredResidential!.length).toBeGreaterThan(0);
  game = buy(game, "valley-electric");
  expect(fleet().capacityWh).toBeCloseTo(capacity, 6);
  expect(game.policies!.programs.battery.spent).toBe(
    policies.programs.battery.spent,
  );
  expect(game.policies!.programs.battery.spending).toBe(
    policies.programs.battery.spending,
  );
  const transferred = currentTick(game)!;
  expect(transferred.customerBatteryWh).toBe(before.customerBatteryWh);
  expect(transferred.customerBatteryWhStart).toBe(
    before.customerBatteryWhStart,
  );
  expect(transferred.deferredResidential).toEqual(before.deferredResidential);
  expect(transferred.deferredThermal).toEqual(before.deferredThermal);
  expect(transferred.deferredCharging).toEqual(before.deferredCharging);
  expect(transferred.customerRate).toBe(before.customerRate);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
  while (game.date.minuteOfDay < 1440 - TICK_MINUTES) tickState(game);
  const closes = game.timeline.at(-1)!;
  tickState(game);
  expect(currentTick(game)!.deferredResidentialStart).toEqual(
    closes.deferredResidential,
  );
  expect(currentTick(game)!.customerBatteryWhStart).toBe(
    closes.customerBatteryWh,
  );
});
