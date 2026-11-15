import "../Store";
import cloneDeep from "lodash.clonedeep";
import { GAME_TO_REAL_YEARS, TICK_MINUTES, TICKS_PER_HOUR } from "../Constants";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import { STORAGE } from "../data/Facilities";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import type {
  GameType,
  GeneratorOperatingType,
  StorageOperatingType,
} from "../Types";
import type { World } from "./Types";
import { applyCommand, createWorld, stepWorld } from "./World";

let opening: World;
beforeAll(() => {
  loadSimData(UTILITY_AREAS.champlain.location);
  opening = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "territory-storage",
    "epoch",
  );
  for (const seat of opening.seats)
    expect(
      applyCommand(opening, seat.id, {
        matchId: opening.matchId,
        epoch: opening.epoch,
        sequence: 1,
        command: { kind: "ready" },
      }),
    ).toBeUndefined();
});

function ready(regional = false) {
  const world = cloneDeep(opening);
  for (const grid of world.grids) {
    grid.facilities = [];
    currentTick(grid)!.storedWh = 0;
    grid.transmission!.buyingRule = "NONE";
    grid.transmission!.sellingRule = "NONE";
    grid.transmission!.lines = grid.transmission!.lines.filter(
      (line) => line.corridorId.startsWith("peer:") || regional,
    );
  }
  demand(world, 100e6);
  return world;
}

function demand(world: World, watts: number) {
  for (const grid of world.grids) {
    const tick = grid.timeline.find(
      (entry) => entry.minute === grid.date.minute + TICK_MINUTES,
    )!;
    tick.demandW = watts;
    for (const type of DEMAND_TYPES)
      tick.demandByType[type] = type === "Residential" ? watts : 0;
  }
}

function battery(grid: GameType) {
  const quote = STORAGE(
    { ...grid, date: { ...grid.date, year: 2025 } },
    500e6,
  ).find(({ name }) => name === "Battery")!;
  expect(quote).toBeDefined();
  const facility: StorageOperatingType = {
    ...quote,
    id: 900,
    territoryId: "champlain",
    peakW: 100e6,
    roundTripEfficiency: 0.9,
    hourlyLoss: 0,
    currentW: 0,
    currentWh: 0,
    yearsToBuildLeft: 0,
    minuteCreated: 0,
    loanAmountTotal: 0,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    lifetimeWh: 0,
    lifetimePotentialWh: 0,
    lifetimeRevenue: 0,
    lifetimeExpenses: 0,
  };
  grid.facilities.push(facility);
  return facility;
}

function generator(grid: GameType, peakW: number, spinMinutes = 1) {
  const template = opening.grids[0].facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  const facility: GeneratorOperatingType = {
    ...(template as GeneratorOperatingType),
    territoryId: "champlain",
    peakW,
    currentW: peakW,
    minimumStableOutput: 0,
    spinMinutes,
    btuPerWh: 1,
    variableOperatingCostPerMWh: 0,
  };
  grid.facilities.push(facility);
}

function advance(world: World) {
  const previous = world.grids.map((grid) => cloneDeep(currentTick(grid)!));
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(TICK_MINUTES);
  for (const [index, grid] of world.grids.entries()) {
    const now = currentTick(grid)!;
    expect(now.storedWh - previous[index].storedWh).toBeCloseTo(
      ((now.storageChargeW ?? 0) - (now.storageDischargeW ?? 0)) /
        TICKS_PER_HOUR -
        now.storageLossWh,
      4,
    );
    expect(now.storageImportedW ?? 0).toBeLessThanOrEqual(
      (now.storageChargeW ?? 0) + 1e-4,
    );
    expect(now.storageImportedW ?? 0).toBeLessThanOrEqual(
      now.importedW! - (now.entitlementImportedW ?? 0) + 1e-4,
    );
    const region = now.territories!.champlain!;
    expect(
      region.generationW + region.storageDischargeW + region.importedW,
    ).toBeCloseTo(
      region.supplyW +
        region.storageChargeW +
        region.exportedW +
        region.curtailedW,
      4,
    );
    expect(region.importedW).toBeCloseTo(now.importedW!, 4);
    expect(region.exportedW).toBeCloseTo(now.exportedW!, 4);
    expect(region.supplyW).toBeCloseTo(now.supplyW, 4);
    if (now.importedW! > 0)
      expect(
        now.expensesImports - (now.agreementUnusedExpenses ?? 0),
      ).toBeCloseTo(
        ((now.importedW! / TICKS_PER_HOUR) *
          GAME_TO_REAL_YEARS *
          now.marketPricePerMWh!) /
          1e6,
        4,
      );
  }
}

function expectCharge(grid: GameType, watts: number) {
  const now = currentTick(grid)!;
  const store = grid.facilities.find((facility) => facility.id === 900)!;
  expect(now.storageChargeW).toBeCloseTo(watts, 4);
  expect(now.storageDischargeW).toBe(0);
  expect(store.currentW).toBeCloseTo(-watts * 0.9, 4);
  expect(store.currentWh).toBeCloseTo((watts * 0.9) / TICKS_PER_HOUR, 4);
  expect(now.storedWh).toBe(store.currentWh);
  expect(now.storageLossWh).toBeCloseTo((watts * 0.1) / TICKS_PER_HOUR, 4);
  expect(now.territories!.champlain!.storageChargeW).toBeCloseTo(watts, 4);
}

it("charges once from local surplus after serving customers during host settlement", () => {
  const world = ready();
  generator(world.grids[0], 300e6, 60);
  battery(world.grids[0]);
  advance(world);
  const now = currentTick(world.grids[0])!;
  expect(now.supplyW).toBe(now.demandW);
  expect(now.importedW).toBe(0);
  expect(now.exportedW).toBe(0);
  expect(now.expensesImports).toBe(0);
  expectCharge(world.grids[0], 100e6);
});

it("stores local wind surplus during host settlement", () => {
  const world = ready();
  const grid = world.grids[0];
  grid.facilities.push({
    ...opening.grids[0].facilities.find(
      (facility) => facility.fuel === "Wind",
    )!,
    peakW: 300e6,
    territoryId: "champlain",
  });
  grid.timeline.find((tick) => tick.minute === TICK_MINUTES)!.windKph = 50;
  battery(grid);
  advance(world);
  const now = currentTick(grid)!;
  expect(now.supplyW).toBe(now.demandW);
  expect(now.importedW).toBe(0);
  expect(now.territories!.champlain!.curtailedW).toBeGreaterThan(0);
  expectCharge(grid, 100e6);
});

it.each(["NONE", "SHORTAGES"] as const)(
  "uses paid agreements for owned storage while buying %s without reselling unused rights",
  (buyingRule) => {
    const world = ready(true);
    const grid = world.grids[0];
    grid.transmission!.buyingRule = buyingRule;
    grid.transmission!.sellingRule = "PROFITABLE";
    battery(grid);
    advance(world);
    const now = currentTick(grid)!;
    expect(now.supplyW).toBe(now.demandW);
    expect(now.entitlementImportedW).toBeCloseTo(now.demandW + 100e6, 4);
    expect(now.importedW).toBe(now.entitlementImportedW);
    expect(now.storageImportedW ?? 0).toBe(0);
    expect(now.exportedW).toBe(0);
    expect(world.edges[0].flowW).toBe(0);
    expectCharge(grid, 100e6);
  },
);

it.each(["open", "limited", "paused"] as const)(
  "charges only with peer energy remaining after customer service on a %s link",
  (status) => {
    const world = ready();
    const seller = world.grids[0];
    const buyer = world.grids[1];
    generator(seller, 1000e6);
    seller.transmission!.sellingRule = "PROFITABLE";
    buyer.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
    battery(buyer);
    for (const grid of world.grids) {
      const line = grid.transmission!.lines[0];
      line.capacityW = status === "limited" ? 150e6 : 1000e6;
      line.paused = status === "paused";
    }
    advance(world);
    const now = currentTick(buyer)!;
    const chargingW =
      status === "open" ? 100e6 : status === "limited" ? 50e6 : 0;
    expectCharge(buyer, chargingW);
    expect(now.supplyW).toBe(status === "paused" ? 0 : now.demandW);
    expect(now.importedW).toBeCloseTo(now.supplyW + chargingW, 4);
    expect(now.storageImportedW).toBeCloseTo(chargingW, 4);
    expect(currentTick(seller)!.exportedW).toBeCloseTo(now.importedW!, 4);
    expect(now.expensesImports).toBeCloseTo(
      ((now.importedW! / TICKS_PER_HOUR) *
        GAME_TO_REAL_YEARS *
        world.pricePerMWh) /
        1e6,
      4,
    );
  },
);

it("buys regional charging energy only after agreements serve the customer load", () => {
  const world = ready(true);
  const grid = world.grids[0];
  grid.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
  demand(world, 200e6);
  battery(grid);
  advance(world);
  const now = currentTick(grid)!;
  expect(now.supplyW).toBe(now.demandW);
  expect(now.storageImportedW).toBeGreaterThan(0);
  expect(now.storageChargeW).toBeLessThanOrEqual(100e6);
  expect(now.importedW).toBeCloseTo(now.demandW + now.storageChargeW!, 4);
  expectCharge(grid, now.storageChargeW!);
});

it("keeps native generation at customer demand when peers sell the charging energy", () => {
  const world = ready();
  const seller = world.grids[0];
  const buyer = world.grids[1];
  generator(seller, 1000e6);
  generator(buyer, 200e6);
  battery(buyer);
  seller.transmission!.sellingRule = "PROFITABLE";
  buyer.transmission!.buyingRule = "SHORTAGES_AND_STORAGE";
  buyer.transmission!.sellingRule = "PROFITABLE";
  for (const grid of world.grids)
    grid.transmission!.lines[0].capacityW = 1000e6;
  advance(world);
  const now = currentTick(buyer)!;
  expect(now.supplyByFuel["Natural Gas"]).toBe(now.demandW);
  expect(
    buyer.facilities.find(({ fuel }) => fuel === "Natural Gas")!.currentW,
  ).toBe(now.demandW);
  expect(now.exportedW).toBe(0);
  expect(now.territories!.champlain!.curtailedW).toBe(0);
  expect(now.importedW).toBeCloseTo(100e6, 4);
  expect(now.storageImportedW).toBeCloseTo(100e6, 4);
  expect(currentTick(seller)!.exportedW).toBeCloseTo(now.importedW!, 4);
  expect(now.expensesImports).toBeCloseTo(
    ((now.importedW! / TICKS_PER_HOUR) *
      GAME_TO_REAL_YEARS *
      world.pricePerMWh) /
      1e6,
    4,
  );
  expectCharge(buyer, 100e6);
});
