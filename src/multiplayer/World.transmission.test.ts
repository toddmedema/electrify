import "../Store";
import cloneDeep from "lodash.clonedeep";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { TICK_MINUTES, TICKS_PER_HOUR, GAME_TO_REAL_YEARS } from "../Constants";
import { currentTick } from "../helpers/GameSelectors";
import {
  intertieContextForGame,
  intertieOfferLimits,
  physicalNeighborImportSupplyW,
} from "../helpers/Transmission";
import { customerMarketSizeAt } from "../helpers/Customers";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { applyCommand, createWorld, stepWorld } from "./World";

function ready(keepNative = false) {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(4),
    "regional-budget",
    "epoch",
  );
  world.grids.forEach((grid) => {
    if (!keepNative) grid.facilities = [];
  });
  for (const seat of world.seats)
    expect(
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: 1,
        command: { kind: "ready" },
      }),
    ).toBeUndefined();
  return world;
}
function setNextDemand(world: ReturnType<typeof ready>, watts: number) {
  for (const grid of world.grids) {
    const tick = grid.timeline.find(
      (t) => t.minute === grid.date.minute + TICK_MINUTES,
    )!;
    tick.demandW = watts;
    DEMAND_TYPES.forEach((type) => {
      tick.demandByType[type] = type === "Residential" ? watts : 0;
    });
  }
}
function regionalBudget(world: ReturnType<typeof ready>) {
  const grid = world.grids[0],
    tick = currentTick(grid)!;
  return physicalNeighborImportSupplyW(
    "vt-champlain-regional",
    intertieContextForGame(grid),
    tick.minute,
    tick,
  );
}
function assertFeasible(world: ReturnType<typeof ready>) {
  let totalImportsW = 0,
    totalReserveW = 0,
    totalAvailableW = 0;
  for (const grid of world.grids) {
    const tick = currentTick(grid)!;
    const line = grid.transmission!.lines.find(
      (l) => l.corridorId === "vt-champlain-regional",
    )!;
    const limits =
      line.yearsToBuildLeft > 0
        ? { importLimitW: 0 }
        : intertieOfferLimits(
            line,
            intertieContextForGame(grid),
            tick.minute,
            tick,
          );
    expect(tick.importedW! + Math.max(0, tick.reserveW!)).toBeLessThanOrEqual(
      limits.importLimitW + 1e-5,
    );
    expect(tick.availableSupplyW).toBeLessThanOrEqual(
      limits.importLimitW + 1e-5,
    );
    expect(line.currentFlowW).toBeCloseTo(tick.importedW!, 5);
    expect(tick.expensesImports).toBeCloseTo(
      (((tick.importedW! / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS) / 1e6) *
        tick.marketPricePerMWh!,
      5,
    );
    expect(tick.importedKgco2e).toBeCloseTo(
      (((tick.importedW! / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS) / 1e6) *
        tick.importKgco2ePerMWh!,
      5,
    );
    totalImportsW += tick.importedW!;
    totalReserveW += Math.max(0, tick.reserveW!);
    totalAvailableW += tick.availableSupplyW!;
  }
  expect(totalImportsW).toBeLessThanOrEqual(regionalBudget(world) + 1e-5);
  expect(totalImportsW + totalReserveW).toBeLessThanOrEqual(
    regionalBudget(world) + 1e-5,
  );
  expect(totalAvailableW).toBeLessThanOrEqual(regionalBudget(world) + 1e-5);
}

it.each(["NONE", "SHORTAGES", "SHORTAGES_AND_STORAGE"] as const)(
  "allocates unused regional reserve once across four companies buying %s",
  (buyingRule) => {
    const world = ready();
    world.grids.forEach((grid) => {
      grid.transmission!.buyingRule = buyingRule;
    });
    setNextDemand(world, 100e6);
    stepWorld(world);
    expect(world.grids.map((g) => currentTick(g)!.importedW)).toEqual([
      100e6, 100e6, 100e6, 100e6,
    ]);
    assertFeasible(world);
    expect(
      world.grids.reduce(
        (sum, grid) => sum + currentTick(grid)!.availableSupplyW!,
        0,
      ),
    ).toBeCloseTo(regionalBudget(world), 5);
  },
);

it.each(["paused", "unbuilt"] as const)(
  "gives a %s connection no imports or reserve",
  (status) => {
    const world = ready();
    const line = world.grids[0].transmission!.lines.find(
      (entry) => entry.corridorId === "vt-champlain-regional",
    )!;
    line.currentFlowW = 0;
    if (status === "paused") line.paused = true;
    else line.yearsToBuildLeft = 1;
    setNextDemand(world, 100e6);
    stepWorld(world);
    expect(currentTick(world.grids[0])!.importedW).toBe(0);
    expect(currentTick(world.grids[0])!.availableSupplyW).toBe(0);
    expect(currentTick(world.grids[0])!.reserveW).toBe(-100e6);
    assertFeasible(world);
  },
);

it("preserves native generator reserves when regional connections have no headroom", () => {
  const world = ready(true);
  for (const grid of world.grids)
    for (const line of grid.transmission!.lines) line.paused = true;
  setNextDemand(world, 1e6);
  const native = cloneDeep(world);
  native.grids.forEach((grid) => {
    delete grid.utilityExpansion;
  });
  stepWorld(world);
  stepWorld(native);
  world.grids.forEach((grid, i) => {
    const tick = currentTick(grid)!,
      comparison = currentTick(native.grids[i])!;
    expect(tick.importedW).toBe(0);
    expect(tick.reserveW).toBeGreaterThan(0);
    expect(tick.availableSupplyW).toBeGreaterThan(tick.supplyW);
    expect(tick.reserveW).toBe(comparison.reserveW);
    expect(tick.availableSupplyW).toBe(comparison.availableSupplyW);
  });
});

it("keeps the refreshed month-opening imports within the shared regional budget", () => {
  const world = ready();
  for (let tick = 0; tick < 95; tick++) stepWorld(world);
  expect(world.grids[0].date.minute).toBe(1425);
  for (const grid of world.grids) {
    expect(180000).toBeLessThanOrEqual(
      customerMarketSizeAt(grid.customerMarketSize, grid.date.minute),
    );
    currentTick(grid)!.customers = 180000;
  }
  const replay = cloneDeep(world);
  stepWorld(world);
  stepWorld(replay);
  expect(world.grids.map((g) => g.date.minute)).toEqual([
    1440, 1440, 1440, 1440,
  ]);
  assertFeasible(world);
  world.grids.forEach((grid, i) => {
    expect(currentTick(grid)).toEqual(currentTick(replay.grids[i]));
    expect(grid.transmission!.lines).toEqual(
      replay.grids[i].transmission!.lines,
    );
    expect(currentTick(grid)!.customers).toBeLessThanOrEqual(
      customerMarketSizeAt(grid.customerMarketSize, grid.date.minute),
    );
  });
});
