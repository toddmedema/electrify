import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH, TICK_MINUTES, YEARS_PER_TICK } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { POLICIES } from "../data/Policies";
import { getScenario } from "../data/Scenarios";
import { UTILITY_TARGETS } from "../data/UtilityExpansion";
import { customerBatteryFleet } from "../helpers/CustomerBatteries";
import { getMarketRate } from "../helpers/Customers";
import { acquisitionQuote, gameForOperatingArea } from "../helpers/Expansion";
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

it("company-wide rollout choices remain available while a newly acquired cohort is unfinished", () => {
  let game = connection(preparedCompany(), "valley-electric");
  game = copyOfficialGame(
    reducer(game, schedulePolicy({ id: "efficiency", tier: "On", month: 1 })),
  );
  expect(game.policies?.programs.efficiency.pending?.tier).toBe("On");
  runMonths(game, POLICIES.efficiency.buildoutMonths);
  expect(game.policies!.programs.efficiency.adoption).toBe(1);
  const original = cloneDeep(game.policies!.programs.efficiency);
  game = buy(game, "valley-electric");
  const target = () =>
    game.utilityExpansion!.areas.find((area) => area.id === "valley-electric")!
      .policies!.programs.efficiency;
  expect(target().adoption).toBe(0);
  expect(target().installs).toEqual([]);
  expect(target().spent).toBe(0);
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
  expect(target().pending?.tier).toBe("Off");
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
  runMonths(game, 1);
  expect(game.policies!.programs.efficiency.installs).toEqual(
    original.installs,
  );
  expect(game.policies!.programs.efficiency.spent).toBe(original.spent);
  expect(target().adoption).toBe(0);
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
  expect(target().adoption).toBeGreaterThan(0);
  expect(target().spent).toBeGreaterThan(0);
  expect(game.policies!.programs.efficiency.spent).toBe(original.spent);
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

it("acquisition starts fresh hardware and demand queues, while each existing area's carry survives month rollover", () => {
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
  const local = gameForOperatingArea(game, "champlain")!;
  const fleet = customerBatteryFleet(
    game.policies!.programs.battery,
    game.date.monthsElapsed,
    game.startingYear,
    programCustomers(local),
    local.location,
  );
  expect(fleet.capacityWh).toBeGreaterThan(0);
  const frame = currentTick(game)!;
  frame.areaTicks!.champlain!.customerBatteryWh = fleet.capacityWh / 2;
  frame.areaTicks!.champlain!.customerBatteryWhStart = fleet.capacityWh / 2;
  frame.customerBatteryWh = Object.values(frame.areaTicks!).reduce(
    (sum, area) => sum + (area?.customerBatteryWh ?? 0),
    0,
  );
  frame.customerBatteryWhStart = frame.customerBatteryWh;
  game = connection(game, "valley-electric");
  game = copyOfficialGame(reducer(game, delta({ dollarsPerkWh: 0.2 })));
  const previous = cloneDeep(currentTick(game)!.areaTicks!.champlain!);
  const programs = cloneDeep(game.policies);
  expect(previous.deferredResidential!.length).toBeGreaterThan(0);
  const sellerRate = getMarketRate(
    getScenario(116)!.dollarsPerkWh,
    game.date,
    game.startingYear,
    game.seed,
  );
  game = buy(game, "valley-electric");
  const transferred = currentTick(game)!.areaTicks!["valley-electric"]!;
  expect(transferred.customerBatteryWhStart ?? 0).toBe(0);
  expect(transferred.customerBatteryWh ?? 0).toBe(0);
  expect(transferred.deferredResidentialStart).toEqual([]);
  expect(transferred.deferredThermalStart ?? []).toEqual([]);
  expect(transferred.deferredChargingStart ?? []).toEqual([]);
  expect(transferred.customerRate).toBe(sellerRate);
  expect(
    game.utilityExpansion!.areas.find((area) => area.id === "valley-electric")!
      .policies!.programs.battery.installs,
  ).toEqual([]);
  expect(game.policies).toEqual(programs);
  expect(currentTick(game)!.areaTicks!.champlain!.customerBatteryWh).toBe(
    previous.customerBatteryWh,
  );
  expect(
    currentTick(game)!.areaTicks!.champlain!.deferredResidentialStart,
  ).toEqual(previous.deferredResidentialStart);
  while (game.date.minuteOfDay < 1440 - TICK_MINUTES) tickState(game);
  const closes = game.timeline.at(-1)!;
  tickState(game);
  const next = currentTick(game)!;
  expect(next.areaTicks!.champlain!.deferredResidentialStart).toEqual(
    closes.areaTicks!.champlain!.deferredResidential,
  );
  expect(next.areaTicks!.champlain!.customerBatteryWhStart).toBe(
    closes.areaTicks!.champlain!.customerBatteryWh,
  );
  expect(next.areaTicks!["valley-electric"]!.customerBatteryWhStart ?? 0).toBe(
    0,
  );
});
