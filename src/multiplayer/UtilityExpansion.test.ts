import { DEMAND_TYPES } from "../data/DemandProfiles";
import cloneDeep from "lodash.clonedeep";
import { isStorage } from "../Types";
import { getTimeFromTimeline } from "../helpers/DateTime";
import {
  recordDispatchTarget,
  prepareGeneratorCommitment,
} from "../helpers/Commitment";
import { getFuelPricesPerMBTU } from "../data/FuelPrices";
import { checkTick, InvariantCollector } from "../testing/Invariants";
import { store } from "../Store";
import {
  YEARS_PER_TICK,
  TICK_MINUTES,
  TICKS_PER_HOUR,
  GAME_TO_REAL_YEARS,
  FUELS,
} from "../Constants";
import { loadSimData } from "../testing/SimData";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { corridorsForGame } from "../data/IntertieAccess";
import { coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";
import type { Command, World } from "./Types";

function command(world: World, action: Command) {
  return applyCommand(world, "0", {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences["0"] || 0) + 1,
    command: action,
  });
}
function ready() {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "expansion",
    "epoch",
  );
  currentTick(world.grids[0])!.cash = 1e9;
  expect(corridorsForGame(world.grids[0]).map((c) => c.id)).toEqual(
    expect.arrayContaining(["vt-champlain-valley", "vt-champlain-ridge"]),
  );
  expect(
    command(world, {
      kind: "action",
      name: "buildTransmissionLine",
      payload: { corridorId: "vt-champlain-ridge", financed: true },
    }),
  ).toBeUndefined();
  world.grids[0].transmission!.lines.find(
    (l) => l.corridorId === "vt-champlain-ridge",
  )!.yearsToBuildLeft = 0;
  return world;
}

it("host acquires a fictional utility while keeping other human companies independent", () => {
  const world = ready();
  const peerBefore = JSON.stringify(world.grids[1]);
  const quote = acquisitionQuote(world.grids[0], "ridge-electric")!;
  expect(quote).toBeDefined();
  const action: Command = {
    kind: "action",
    name: "acquireUtility",
    payload: {
      targetId: "ridge-electric",
      financed: true,
      quoteKey: quote.quoteKey,
    },
  };
  expect(command(world, action)).toBeUndefined();
  expect(
    world.grids[0].utilityExpansion!.acquisitions.map((a) => a.targetId),
  ).toContain("ridge-electric");
  expect(JSON.stringify(world.grids[1])).toBe(peerBefore);
  expect(roomView(world, "0").game!.utilityExpansion).toEqual(
    world.grids[0].utilityExpansion,
  );
  expect(command(world, action)).toMatch(/changed|quote|acquisition/i);
  const checkpoint = checkpointWorld(world);
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpoint)),
    "new-epoch",
  );
  expect(restored).toBeDefined();
  expect(restored!.grids[0].utilityExpansion).toEqual(
    world.grids[0].utilityExpansion,
  );
  for (const seat of world.seats)
    applyCommand(world, seat.id, {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences[seat.id] || 0) + 1,
      command: { kind: "ready" },
    });
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(world.grids[1].date.minute);
});

it("host rejects forged human-target ownership and wrong-target connections", () => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(
    command(world, {
      kind: "action",
      name: "acquireUtility",
      payload: { targetId: "1", financed: true, quoteKey: "forged" },
    }),
  ).toMatch(/valid acquisition/i);
  expect(
    command(world, {
      kind: "action",
      name: "acquireUtility",
      payload: {
        targetId: "valley-electric",
        financed: true,
        quoteKey: "forged",
      },
    }),
  ).toMatch(/changed|quote/i);
  expect(JSON.stringify(world.grids[0])).toBe(before);
});

it("host completes a shared company plant without scheduling renderer notifications", () => {
  const world = ready();
  const quote = acquisitionQuote(world.grids[0], "ridge-electric")!;
  expect(
    command(world, {
      kind: "action",
      name: "acquireUtility",
      payload: {
        targetId: quote.targetId,
        financed: true,
        quoteKey: quote.quoteKey,
      },
    }),
  ).toBeUndefined();
  expect(
    command(world, {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: {
          name: "Natural Gas CC",
          peakW: 100e6,
          gasCycle: "combined",
        },
        financed: true,
      },
    }),
  ).toBeUndefined();
  const project = world.grids[0].facilities.find(
    (facility) => facility.yearsToBuildLeft > 0,
  )!;
  expect(project).toBeDefined();
  project.yearsToBuildLeft = YEARS_PER_TICK / 2;
  for (const seat of world.seats)
    applyCommand(world, seat.id, {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences[seat.id] || 0) + 1,
      command: { kind: "ready" },
    });
  jest.useFakeTimers();
  const dispatch = jest.spyOn(store, "dispatch");
  try {
    stepWorld(world);
    expect(project.yearsToBuildLeft).toBe(0);
    expect(world.grids[0].date.minute).toBe(TICK_MINUTES);
    jest.runOnlyPendingTimers();
    expect(dispatch).not.toHaveBeenCalled();
    expect(world.grids[0].multiplayer?.peers).toHaveLength(1);
  } finally {
    dispatch.mockRestore();
    jest.useRealTimers();
  }
});

it.each([300e6, 400e6])(
  "pooled company exports native gas at %i W demand without reselling source rights",
  (companyDemandW) => {
    const world = ready();
    const quote = acquisitionQuote(world.grids[0], "ridge-electric")!;
    expect(
      command(world, {
        kind: "action",
        name: "acquireUtility",
        payload: {
          targetId: quote.targetId,
          financed: true,
          quoteKey: quote.quoteKey,
        },
      }),
    ).toBeUndefined();
    expect(
      command(world, {
        kind: "action",
        name: "buildFacility",
        payload: {
          facility: {
            name: "Natural Gas CC",
            peakW: 200e6,
            gasCycle: "combined",
          },
          financed: true,
        },
      }),
    ).toBeUndefined();
    const seller = world.grids[0];
    const gas = seller.facilities.find((f) => f.yearsToBuildLeft > 0)!;
    expect(gas.fuel).toBe("Natural Gas");
    if (isStorage(gas)) throw new Error("Expected gas generation");
    gas.yearsToBuildLeft = 0;
    gas.currentW = gas.peakW;
    gas.committed = true;
    recordDispatchTarget(
      getTimeFromTimeline(2 * TICK_MINUTES, seller.timeline)!,
      gas.id,
      gas.peakW,
    );
    prepareGeneratorCommitment({
      facilityId: gas.id,
      forecast: seller.timeline,
      minimumOperatingCost: () => 0,
    });
    const demand = (game: typeof seller, watts: number) => {
      const tick = getTimeFromTimeline(TICK_MINUTES, game.timeline)!;
      tick.demandW = watts;
      for (const type of DEMAND_TYPES)
        tick.demandByType[type] = type === "Residential" ? watts : 0;
    };
    for (const game of world.grids) {
      for (const facility of game.facilities)
        facility.paused = game !== seller || facility.id !== gas.id;
      demand(game, game === seller ? companyDemandW : 800e6);
    }
    for (const seat of world.seats)
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: (world.sequences[seat.id] || 0) + 1,
        command: { kind: "ready" },
      });
    const isolated = cloneDeep(world);
    for (const game of isolated.grids)
      for (const line of game.transmission!.lines)
        if (line.corridorId.startsWith("peer:")) line.paused = true;
    const rightsOnly = cloneDeep(world);
    for (const facility of rightsOnly.grids[0].facilities)
      facility.paused = true;
    demand(rightsOnly.grids[0], 50e6);
    stepWorld(rightsOnly);
    expect(rightsOnly.edges[0].flowW).toBe(0);
    expect(currentTick(rightsOnly.grids[0])!.exportedW).toBe(0);
    stepWorld(isolated);
    stepWorld(world);
    const sentW = world.edges[0].flowW;
    expect(sentW).toBeGreaterThan(1e6);
    const sold = currentTick(world.grids[0])!,
      alone = currentTick(isolated.grids[0])!;
    const buyer = currentTick(world.grids[1])!,
      buyerAlone = currentTick(isolated.grids[1])!;
    const actualGas = world.grids[0].facilities.find((f) => f.id === gas.id)!,
      isolatedGas = isolated.grids[0].facilities.find((f) => f.id === gas.id)!;
    expect(sold.entitlementImportedW).toBeCloseTo(
      alone.entitlementImportedW!,
      4,
    );
    expect(actualGas.currentW - isolatedGas.currentW).toBeCloseTo(sentW, 4);
    const btu = ((sentW * gas.btuPerWh!) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
    const kg = btu * FUELS["Natural Gas"]!.kgCO2ePerBtu;
    const fuelPrice = getFuelPricesPerMBTU(
      seller.date,
      seller.seed,
      seller.location,
    )["Natural Gas"]!;
    expect(sold.expensesFuel - alone.expensesFuel).toBeCloseTo(
      (btu * fuelPrice) / 1e6,
      4,
    );
    expect(sold.localKgco2e! - alone.localKgco2e!).toBeCloseTo(kg, 4);
    expect(buyer.importedKgco2e! - buyerAlone.importedKgco2e!).toBeCloseTo(
      kg,
      4,
    );
    expect(sold.revenueExports).toBeGreaterThan(0);
    const invariants = new InvariantCollector();
    checkTick(
      invariants,
      world.grids[0],
      null,
      sold,
      "shared native export",
      false,
    );
    expect(
      invariants.getCountByRule()["a tick never imports and exports at once"],
    ).toBeUndefined();
  },
);

it("the host rejects obsolete build destinations instead of creating a second dispatch area", () => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(
    command(world, {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: {
          name: "Natural Gas CC",
          peakW: 100e6,
          gasCycle: "combined",
        },
        financed: true,
        operatingAreaId: "ridge-electric",
      },
    }),
  ).toMatch(/without an operating.area/i);
  expect(JSON.stringify(world.grids[0])).toBe(before);
});
