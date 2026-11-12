import "../Store";
import cloneDeep from "lodash.clonedeep";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { TICK_MINUTES, TICKS_PER_HOUR, GAME_TO_REAL_YEARS } from "../Constants";
import {
  agreementYearMinute,
  connectionAgreements,
  powerAgreementQuote,
} from "../helpers/PowerAgreements";
import { getDateFromMinute } from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import {
  intertieContextForGame,
  intertieOfferLimits,
  physicalNeighborImportSupplyW,
} from "../helpers/Transmission";
import { customerMarketSizeAt } from "../helpers/Customers";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  stepWorld,
} from "./World";
import { ViewPublication } from "./ViewPublication";

function ready(keepNative = false) {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(4),
    "regional-budget",
    "epoch",
  );
  world.grids.forEach((grid) => {
    grid.transmission!.inheritedAgreementTerms = 2;
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
    const unusedCost = Object.entries(tick.agreementAvailableMWh ?? {}).reduce(
      (sum, [id, available]) => {
        const source = connectionAgreements(grid, "champlain").find(
          (entry) => entry.id === id,
        )!;
        return (
          sum +
          (available - (tick.agreementUsefulMWh?.[id] ?? 0)) * source.priceToday
        );
      },
      0,
    );
    expect(tick.expensesImports - unusedCost).toBeCloseTo(
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
    expect(world.grids.map((g) => currentTick(g)!.importedW)).toEqual(
      buyingRule === "NONE"
        ? [100e6, 100e6, 0, 0]
        : [100e6, 100e6, 100e6, 100e6],
    );
    assertFeasible(world);
    const available = world.grids.reduce(
      (sum, grid) => sum + currentTick(grid)!.availableSupplyW!,
      0,
    );
    expect(available).toBeLessThanOrEqual(regionalBudget(world) + 1e-5);
    expect(available / regionalBudget(world)).toBeGreaterThan(
      buyingRule === "NONE" ? 0 : 0.99999,
    );
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

it("assigns supplier-ready commitments once independently from pause and consumption", () => {
  const world = ready();
  setNextDemand(world, 0);
  const paused = cloneDeep(world);
  paused.grids[0].transmission!.lines[0].paused = true;
  stepWorld(world);
  stepWorld(paused);
  const available = (grid: (typeof world.grids)[number]) =>
    Object.values(currentTick(grid)!.agreementAvailableMWh ?? {}).reduce(
      (sum, value) => sum + value,
      0,
    );
  expect(paused.grids.map(available)).toEqual(world.grids.map(available));
  const totalMWh = world.grids.reduce((sum, grid) => sum + available(grid), 0);
  expect(totalMWh).toBeCloseTo(
    ((regionalBudget(world) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS) / 1e6,
    5,
  );
  world.grids.forEach((grid) => {
    expect(currentTick(grid)!.importedW).toBe(0);
    expect(currentTick(grid)!.exportedW).toBe(0);
  });
});

it("publishes signed terms and current minimum-payment history to each owning renderer", () => {
  const world = ready();
  for (const grid of world.grids) {
    const minute = agreementYearMinute(2018);
    grid.date = getDateFromMinute(minute, grid.startingYear);
    grid.timeline.forEach((tick) => {
      tick.minute += minute;
    });
    grid.objectiveProgress = undefined;
  }
  const quote = powerAgreementQuote(world.grids[0], "champlain-nuclear")!;
  expect(quote).toBeDefined();
  expect(
    applyCommand(world, "0", {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: 2,
      command: {
        kind: "action",
        name: "acceptPowerAgreement",
        payload: { blockId: quote.id, quoteKey: quote.quoteKey },
      },
    }),
  ).toBeUndefined();
  setNextDemand(world, 0);
  stepWorld(world);
  const publication = new ViewPublication();
  publication.request(world, 0, { force: true });
  const views = publication.take(world, 0);
  expect(views["0"].game!.transmission!.acceptedAgreements).toEqual([
    quote.receipt,
  ]);
  expect(currentTick(views["0"].game!)!.expensesImports).toBeGreaterThan(0);
  expect(views["0"].game!.transmission!.agreementAccounts).toBeDefined();
  expect(
    views["0"].game!.transmission!.agreementAccounts!.length,
  ).toBeGreaterThan(0);
  for (const [index, grid] of world.grids.entries()) {
    const published = views[String(index)].game!;
    expect(published.transmission!.inheritedAgreementTerms).toBe(2);
    expect(published.transmission!.agreementAccounts).toEqual(
      grid.transmission!.agreementAccounts,
    );
    expect(published.transmission!.agreementAccounts ?? []).not.toBe(
      grid.transmission!.agreementAccounts,
    );
  }
  expect(views["1"].game!.transmission!.acceptedAgreements).toBeUndefined();
});

it("reserves a later company's useful agreement delivery before an earlier company's spot demand", () => {
  const world = ready();
  setNextDemand(world, 100e6);
  world.grids[0].timeline[1].demandW = 300e6;
  stepWorld(world);
  expect(currentTick(world.grids[1])!.entitlementImportedW).toBe(100e6);
  assertFeasible(world);
});

it("closes shared v3 monthly minima once and restores a midmonth checkpoint identically", () => {
  const world = ready();
  for (const grid of world.grids) {
    grid.transmission!.inheritedAgreementTerms = 3;
    grid.transmission!.lines[0].paused = true;
    grid.transmission!.buyingRule = "NONE";
  }
  for (let i = 0; i < 48; i++) stepWorld(world);
  const checkpoint = JSON.parse(JSON.stringify(checkpointWorld(world)));
  const restored = restoreWorld(checkpoint, "monthly-resume");
  for (const seat of restored.seats) {
    expect(
      applyCommand(restored, seat.id, {
        matchId: restored.matchId,
        epoch: restored.epoch,
        sequence: 1,
        command: { kind: "ready" },
      }),
    ).toBeUndefined();
  }
  for (let i = 0; i < 48; i++) {
    stepWorld(world);
    stepWorld(restored);
  }
  expect(world.grids[0].date.minute).toBe(1440);
  for (const [index, grid] of world.grids.entries()) {
    const accounts = grid.transmission!.agreementAccounts!;
    expect(accounts.length).toBeGreaterThan(0);
    expect(restored.grids[index].transmission!.agreementAccounts).toEqual(
      accounts,
    );
    expect(currentTick(restored.grids[index])!.cash).toBe(
      currentTick(grid)!.cash,
    );
    for (const account of accounts) {
      expect(account.accountedThroughMinute).toBe(1440);
      expect(account.months[0].payment).toBeCloseTo(
        account.months[0].availableValue! * 0.7,
        6,
      );
      expect(account.months[0].usefulMWh).toBe(0);
    }
    expect(currentTick(grid)!.importedW).toBe(0);
    expect(currentTick(grid)!.importedKgco2e).toBe(0);
  }
  const closed = cloneDeep(
    world.grids.map((grid) =>
      grid.transmission!.agreementAccounts!.map((account) => account.months[0]),
    ),
  );
  stepWorld(world);
  expect(
    world.grids.map((grid) =>
      grid.transmission!.agreementAccounts!.map((account) => account.months[0]),
    ),
  ).toEqual(closed);
});
