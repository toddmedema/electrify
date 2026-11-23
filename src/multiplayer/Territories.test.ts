import { intertieBuildQuote } from "../helpers/Transmission";
import { accessContextForGame } from "../data/IntertieAccess";
import { getMonthlyPayment } from "../helpers/Financials";
import cloneDeep from "lodash.clonedeep";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import {
  landPurchaseQuote,
  ownedTerritories,
  territoryBuildAvailability,
} from "../helpers/Territories";
import { ownsTerritoryTile } from "../helpers/TerritoryTiles";
import { loadSimData } from "../testing/SimData";
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
function command(world: World, seat: string, action: Command) {
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: action,
  });
}
function ready() {
  loadSimData(UTILITY_AREAS.champlain.location);
  return createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "territories",
    "epoch",
  );
}
const wind = (territoryId: unknown, peakW = 50e6): Command => ({
  kind: "action",
  name: "buildFacility",
  payload: {
    territoryId,
    financed: true,
    facility: { name: "Wind", peakW, buildCost: 0 },
  },
});
it("host rejects unknown, unowned and oversized build destinations atomically", () => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(command(world, "0", wind("imaginary-territory"))).toMatch(
    /territory/i,
  );
  expect(command(world, "0", wind("valley-electric"))).toBeDefined();
  expect(command(world, "0", wind("champlain", 1e9))).toBeDefined();
  expect(JSON.stringify(world.grids[0])).toBe(before);
});
it("first accepted claim owns finite shared land; the loser keeps cash and cannot build there after restart", () => {
  const world = ready();
  const quotes = world.grids.map((grid) => landPurchaseQuote(grid)!);
  const losingCash = currentTick(world.grids[1])!.cash;
  const payloads = quotes.map((quote) => ({
    territoryId: quote.territoryId,
    quoteKey: quote.quoteKey,
  }));
  const winningCash = currentTick(world.grids[0])!.cash;
  expect(
    command(world, "0", {
      kind: "action",
      name: "acquireLand",
      payload: payloads[0],
    }),
  ).toBeUndefined();
  expect(
    command(world, "1", {
      kind: "action",
      name: "acquireLand",
      payload: payloads[1],
    }),
  ).toMatch(/owned/i);
  expect(currentTick(world.grids[1])!.cash).toBe(losingCash);
  expect(currentTick(world.grids[0])!.cash).toBeCloseTo(
    winningCash - quotes[0].price,
    5,
  );
  expect(ownsTerritoryTile(world.grids[0], quotes[0].tileId)).toBe(true);
  expect(ownedTerritories(world.grids[0])).not.toContain("green-uplands");
  expect(ownedTerritories(world.grids[1])).not.toContain("green-uplands");
  expect(
    roomView(world, "1").game!.multiplayer!.tileOwners?.["green-uplands:site-0"]
      ?.seat,
  ).toBe("0");
  expect(command(world, "1", wind("green-uplands"))).toBeDefined();
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "restart",
  );
  expect(ownsTerritoryTile(restored.grids[0], quotes[0].tileId)).toBe(true);
  expect(ownedTerritories(restored.grids[0])).not.toContain("green-uplands");
  expect(
    command(restored, "1", {
      kind: "action",
      name: "acquireLand",
      payload: payloads[1],
    }),
  ).toMatch(/owned/i);
  expect(command(restored, "1", wind("green-uplands"))).toBeDefined();
});
it("host rejects cheap quotes, duplicates, and unaffordable purchases before any mutation", () => {
  const world = ready();
  const quote = landPurchaseQuote(world.grids[0])!;
  const before = cloneDeep(world.grids);
  expect(
    command(world, "0", {
      kind: "action",
      name: "acquireLand",
      payload: {
        territoryId: quote.territoryId,
        quoteKey: quote.quoteKey,
        price: 0,
      },
    }),
  ).toMatch(/unavailable/i);
  expect(JSON.stringify(world.grids)).toEqual(JSON.stringify(before));
  currentTick(world.grids[0])!.cash = quote.price - 1;
  const low = cloneDeep(world.grids);
  expect(
    command(world, "0", {
      kind: "action",
      name: "acquireLand",
      payload: { territoryId: quote.territoryId, quoteKey: quote.quoteKey },
    }),
  ).toMatch(/unaffordable/i);
  expect(JSON.stringify(world.grids)).toEqual(JSON.stringify(low));
});
it("host uses its own facility price and reserves each land site", () => {
  const world = ready();
  currentTick(world.grids[0])!.cash = 1e9;
  for (let i = 0; i < 7; i++) {
    const next = landPurchaseQuote(world.grids[0])!;
    expect(
      command(world, "0", {
        kind: "action",
        name: "acquireLand",
        payload: { territoryId: next.territoryId, quoteKey: next.quoteKey },
      }),
    ).toBeUndefined();
  }
  for (const seat of world.seats)
    expect(
      command(world, seat.id, { kind: "speed", speed: "FAST" }),
    ).toBeUndefined();
  const connectionMinute =
    world.grids[0].territoryNetwork!.tilePurchases![0].connectionMinute!;
  expect(command(world, "0", wind("green-uplands"))).toBeDefined();
  while (world.grids[0].date.minute < connectionMinute) stepWorld(world);
  for (let i = 0; i < 7; i++)
    expect(command(world, "0", wind("green-uplands"))).toBeUndefined();
  const built = world.grids[0].facilities.find(
    (f) => f.territoryId === "green-uplands",
  )!;
  expect(built.buildCost).toBeGreaterThan(0);
  expect(
    territoryBuildAvailability(world.grids[0], built, "green-uplands")
      .remaining,
  ).toBe(0);
  const before = cloneDeep(world.grids);
  expect(command(world, "0", wind("green-uplands"))).toBeDefined();
  expect(JSON.stringify(world.grids)).toEqual(JSON.stringify(before));
});
it("does not expose player managed wires in the valley co-op", () => {
  const world = ready();
  const corridorId = world.grids[0].multiplayer!.peers![0].corridor.id;
  for (const name of ["buildTransmissionLine", "upgradeTransmissionLine"])
    expect(
      command(world, "0", {
        kind: "action",
        name,
        payload: { corridorId, financed: false },
      }),
    ).toBeDefined();
  expect(
    world.grids[0].transmission!.lines.every(
      (line) => line.buildCost === 0 && line.annualOperatingCost === 0,
    ),
  ).toBe(true);
});

it("grandfathers prior company-local land rights through the recognized schema13 bridge", () => {
  const world = ready();
  const old = JSON.parse(JSON.stringify(checkpointWorld(world)));
  old.gameSchema = 13;
  old.rules =
    "coop-2-34d99333d49691071b390dc49bfe6c73e43562c61b9fcbf7974f5996b10deaca";
  for (const game of old.grids) {
    game.territoryNetwork = { version: 1 };
    const quote = intertieBuildQuote(
      "vt-champlain-uplands",
      2005,
      1,
      accessContextForGame(game),
    )!;
    game.transmission.lines.push({
      ...quote,
      id: 99,
      corridorId: "vt-champlain-uplands",
      yearsToBuildLeft: quote.yearsToBuild,
      minuteCreated: 0,
      financed: true,
      loanAmountLeft: quote.buildCost * 0.8,
      loanMonthlyPayment: getMonthlyPayment(
        quote.buildCost * 0.8,
        game.interestRate,
        240,
      ),
      interestRate: game.interestRate,
      currentFlowW: 0,
    });
    currentTick(game)!.cash -= quote.buildCost * 0.2;
  }
  const before = JSON.stringify(old);
  const restored = restoreWorld(old, "upgraded");
  expect(JSON.stringify(old)).toBe(before);
  expect(
    restored.grids.every((game) =>
      ownedTerritories(game).includes("green-uplands"),
    ),
  ).toBe(true);
  restored.grids.forEach((game, index) => {
    expect(currentTick(game)!.cash).toBe(currentTick(old.grids[index])!.cash);
    expect(game.territoryNetwork!.landPurchases[0].legacy).toBe(true);
    expect(game.runIdentity).toEqual(old.grids[index].runIdentity);
  });
  expect(() =>
    restoreWorld({ ...old, rules: "unknown-old-rules" }, "bad"),
  ).toThrow(/preserved/);
  expect(() =>
    restoreWorld(
      { ...checkpointWorld(restored), rules: old.rules },
      "bad-current",
    ),
  ).toThrow(/preserved/);
});
