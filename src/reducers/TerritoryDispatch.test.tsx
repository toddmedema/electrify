import { GENERATORS, STORAGE } from "../data/Facilities";
import { GREEN_UPLANDS_CORRIDOR_ID } from "../data/Territories";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { transmissionRatingW } from "../helpers/Transmission";
import { inheritedConnection } from "../helpers/PowerAgreements";
import { territoryBuildAvailability } from "../helpers/Territories";
import { createGame } from "../testing/Simulator";
import { copyOfficialGame } from "../testing/OfficialScenarioExecutionFixtures";
import type { GameType, GeneratorOperatingType, TerritoryId } from "../Types";
import reducer, {
  buildFacility,
  buildTransmissionLine,
  generateForecastTimeline,
  sellFacility,
  tickState,
  togglePauseTransmissionLine,
  upgradeTransmissionLine,
} from "./Game";
import { acquireUtility } from "./GameActions";

let opening: GameType;
beforeAll(() => {
  let game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  currentTick(game)!.cash = 10e9;
  game = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: "vt-champlain-valley",
        financed: false,
      }),
    ),
  );
  game.transmission!.lines.find(
    ({ corridorId }) => corridorId === "vt-champlain-valley",
  )!.yearsToBuildLeft = 0;
  const quote = acquisitionQuote(game, "valley-electric")!;
  opening = copyOfficialGame(
    reducer(
      game,
      acquireUtility({
        targetId: "valley-electric",
        financed: false,
        quoteKey: quote.quoteKey,
      }),
    ),
  );
});
function isolated() {
  const game = copyOfficialGame(opening);
  game.transmission!.lines = game.transmission!.lines.filter(
    ({ corridorId }) => corridorId === "vt-champlain-valley",
  );
  game.transmission!.buyingRule = "NONE";
  game.transmission!.sellingRule = "NONE";
  game.facilities = [];
  return game;
}
function plant(game: GameType, territoryId: TerritoryId, peakW = 600e6) {
  const template = opening.facilities.find(
    (facility) => facility.fuel === "Natural Gas",
  )!;
  const generator: GeneratorOperatingType = {
    ...(template as GeneratorOperatingType),
    id: game.facilities.length + 100,
    territoryId,
    peakW,
    currentW: peakW,
    minimumStableOutput: 0,
    spinMinutes: 1,
    yearsToBuildLeft: 0,
    paused: false,
    startingAssetId: undefined,
  };
  game.facilities.push(generator);
  return generator;
}
function request(game: GameType, demandW = 600e6) {
  const next = game.timeline.find((tick) => tick.minute > game.date.minute)!;
  next.demandW = demandW;
  Object.keys(next.demandByType).forEach((key) => {
    next.demandByType[key as keyof typeof next.demandByType] =
      key === "Residential" ? demandW : 0;
  });
  return next;
}
function expectConserved(game: GameType) {
  const now = currentTick(game)!;
  expect(
    Object.values(now.territories!).reduce(
      (sum, region) => sum + region!.supplyW,
      0,
    ),
  ).toBeCloseTo(now.supplyW, 5);
  expect(
    Object.values(now.territories!).reduce(
      (sum, region) => sum + region!.demandW,
      0,
    ),
  ).toBeCloseTo(now.demandW, 5);
  for (const [id, territory] of Object.entries(now.territories!)) {
    const internalW = game.transmission!.lines.reduce(
      (sum, line) =>
        sum +
        (line.corridorId === "vt-champlain-valley"
          ? id === "champlain"
            ? line.currentFlowW
            : id === "valley-electric"
              ? -line.currentFlowW
              : 0
          : 0),
      0,
    );
    expect(
      territory!.generationW +
        territory!.storageDischargeW +
        territory!.importedW +
        internalW,
    ).toBeCloseTo(
      territory!.supplyW +
        territory!.storageChargeW +
        territory!.exportedW +
        territory!.curtailedW,
      4,
    );
  }
}
function storageQuote(game: GameType) {
  const offset = 60 * MINUTES_PER_MONTH;
  game.date = getDateFromMinute(offset, 2005);
  game.timeline.forEach((tick) => {
    tick.minute += offset;
  });
  return STORAGE(game, 200e6).find(({ name }) => name === "Battery")!;
}

it("serves an acquired plant's local load before limiting its remaining power to the real link", () => {
  const game = isolated();
  plant(game, "valley-electric");
  request(game);
  tickState(game);
  const now = currentTick(game)!;
  const link = game.transmission!.lines[0];
  expect(now.supplyW).toBeLessThan(now.demandW);
  expect(now.territories!["valley-electric"]!.unservedW).toBe(0);
  expect(now.territories!.champlain!.supplyW).toBeLessThanOrEqual(
    transmissionRatingW(link, now),
  );
  expect(link.currentFlowW).toBeCloseTo(transmissionRatingW(link, now), 5);
  expectConserved(game);
});

it("refreshes newly acquired customer demand immediately without advancing asset or agreement balances", () => {
  const now = currentTick(opening)!;
  expect(now.territories!["valley-electric"]!.demandW).toBeGreaterThan(0);
  expect(now.territories!["valley-electric"]!.generationW).toBeGreaterThan(0);
  expect(now.demandW).toBeGreaterThan(
    createGame({ scenarioId: 116, seed: 12345, difficulty: "Employee" })
      .timeline[0].demandW,
  );
  expect(
    opening.facilities.every((facility) => facility.lifetimeWh === 0),
  ).toBe(true);
  expect(
    opening.utilityExpansion!.loans.every(
      (loan) => loan.loanAmountLeft === loan.principal,
    ),
  ).toBe(true);
  expect(opening.transmission!.agreementAccounts).toBeUndefined();
});

it.each(["champlain", "valley-electric"] as const)(
  "generates profitable exports only when the %s plant can physically reach the buyer",
  (territoryId) => {
    const game = isolated();
    const generator = plant(game, territoryId, 600e6);
    generator.btuPerWh = 0;
    generator.variableOperatingCostPerMWh = 0;
    const link = game.transmission!.lines[0];
    link.paused = true;
    game.transmission!.lines.push({
      ...inheritedConnection("champlain", 90),
      corridorId: "vt-champlain-ridge",
      capacityW: 100e6,
    });
    game.transmission!.sellingRule = "PROFITABLE";
    request(game, 300e6);
    const surplusOnly = copyOfficialGame(game);
    surplusOnly.transmission!.sellingRule = "SURPLUS";
    tickState(surplusOnly);
    tickState(game);
    const now = currentTick(game)!;
    const extraGenerationW =
      generator.currentW - surplusOnly.facilities[0].currentW;
    expect(now.exportedW! > 0).toBe(territoryId === "champlain");
    expect(extraGenerationW).toBeCloseTo(now.exportedW!, 4);
    expect(now.entitlementImportedW).toBe(0);
    expect(now.territories!["valley-electric"]!.supplyW).toBe(
      surplusOnly.timeline[1].territories!["valley-electric"]!.supplyW,
    );
    expectConserved(game);
  },
);

it("keeps ownership when a link is paused and cannot teleport acquired generation", () => {
  const game = isolated();
  plant(game, "valley-electric");
  const paused = copyOfficialGame(
    reducer(game, togglePauseTransmissionLine(game.transmission!.lines[0].id)),
  );
  request(paused);
  tickState(paused);
  expect(paused.utilityExpansion!.acquisitions).toHaveLength(1);
  expect(currentTick(paused)!.territories!.champlain!.supplyW).toBe(0);
  expect(
    currentTick(paused)!.territories!["valley-electric"]!.supplyW,
  ).toBeGreaterThan(0);
  expect(paused.transmission!.lines[0].currentFlowW).toBe(0);
  expectConserved(paused);
});

it("serves local PPA customers across a paused acquisition link without buying unreachable delivery", () => {
  const game = copyOfficialGame(opening);
  game.facilities = [];
  game.transmission!.buyingRule = "NONE";
  game.transmission!.lines = game.transmission!.lines.filter(
    ({ corridorId }) =>
      corridorId === "vt-champlain-valley" ||
      corridorId === "vt-valley-regional",
  );
  game.transmission!.lines.find(
    ({ corridorId }) => corridorId === "vt-champlain-valley",
  )!.paused = true;
  request(game, 200e6);
  tickState(game);
  const now = currentTick(game)!;
  expect(now.territories!.champlain!.supplyW).toBe(0);
  expect(now.entitlementImportedW).toBeGreaterThan(0);
  expect(now.entitlementImportedW).toBeCloseTo(
    now.territories!["valley-electric"]!.supplyW,
    5,
  );
  expect(now.territories!["valley-electric"]!.importedW).toBeCloseTo(
    now.entitlementImportedW!,
    5,
  );
  expectConserved(game);
});

it("prioritizes reachable customers over charging and stores stranded local surplus locally", () => {
  for (const source of ["champlain", "valley-electric"] as const) {
    let game = isolated();
    const batteryQuote = storageQuote(game);
    game = copyOfficialGame(
      reducer(
        game,
        buildFacility({
          facility: batteryQuote,
          financed: false,
          territoryId: "valley-electric",
        }),
      ),
    );
    const battery = game.facilities[0];
    expect(battery).toBeDefined();
    battery.yearsToBuildLeft = 0;
    battery.currentWh = 0;
    plant(game, source, 1000e6);
    // Keep the dispatchable generator before storage, matching the normal build order.
    game.facilities.reverse();
    request(game);
    tickState(game);
    expect(battery.currentWh! > 0).toBe(source === "valley-electric");
    expectConserved(game);
  }
});

it("constrains stored discharge to its region and forecasts without mutating live assets", () => {
  let game = isolated();
  game = copyOfficialGame(
    reducer(
      game,
      buildFacility({
        facility: storageQuote(game),
        financed: false,
        territoryId: "valley-electric",
      }),
    ),
  );
  const battery = game.facilities[0];
  battery.yearsToBuildLeft = 0;
  battery.currentWh = battery.peakWh!;
  const before = copyOfficialGame(game);
  const forecast = generateForecastTimeline(
    game,
    currentTick(game)!.cash,
    currentTick(game)!.customers,
  );
  expect(game).toEqual(before);
  expect(
    forecast.every(
      (tick) =>
        tick.territories!.champlain!.supplyW <=
        transmissionRatingW(game.transmission!.lines[0], tick),
    ),
  ).toBe(true);
  request(game);
  tickState(game);
  expect(
    currentTick(game)!.territories!.champlain!.supplyW,
  ).toBeLessThanOrEqual(
    transmissionRatingW(game.transmission!.lines[0], currentTick(game)!),
  );
  expectConserved(game);
});

it("upgrades internal wires without creating more contractual capacity", () => {
  const game = copyOfficialGame(opening);
  const beforeCapacity = currentTick(game)!.entitlementImportCapacityW;
  const upgraded = copyOfficialGame(
    reducer(
      game,
      upgradeTransmissionLine({
        corridorId: "vt-champlain-valley",
        financed: false,
      }),
    ),
  );
  const line = upgraded.transmission!.lines.find(
    ({ corridorId }) => corridorId === "vt-champlain-valley",
  )!;
  expect(line.upgrade).toBeDefined();
  expect(line.capacityW).toBe(
    game.transmission!.lines.find(
      ({ corridorId }) => corridorId === line.corridorId,
    )!.capacityW,
  );
  expect(currentTick(upgraded)!.entitlementImportCapacityW).toBe(
    beforeCapacity,
  );
});

it("rejects stale, oversized and malformed territory builds and frees sold sites", () => {
  const game = isolated();
  const quote = GENERATORS(game, 100e6, [], []).find(
    ({ fuel }) => fuel === "Natural Gas",
  )!;
  for (const territoryId of [
    "green-uplands",
    "ridge-electric",
    "bogus",
  ] as TerritoryId[])
    expect(
      reducer(
        game,
        buildFacility({ facility: quote, financed: false, territoryId }),
      ),
    ).toEqual(game);
  expect(
    reducer(
      game,
      buildFacility({ facility: { ...quote, peakW: 301e6 }, financed: false }),
    ),
  ).toEqual(game);
  const built = copyOfficialGame(
    reducer(
      game,
      buildFacility({
        facility: quote,
        financed: false,
        territoryId: "valley-electric",
      }),
    ),
  );
  expect(built.facilities[0].territoryId).toBe("valley-electric");
  const availability = territoryBuildAvailability(
    built,
    quote,
    "valley-electric",
  );
  const sold = reducer(built, sellFacility(built.facilities[0].id));
  expect(
    territoryBuildAvailability(sold, quote, "valley-electric").remaining,
  ).toBe(availability.remaining + 1);
});

it("connects empty land at its authored size without adding customers or market rights", () => {
  const game = isolated();
  const customers = currentTick(game)!.customers;
  const built = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: GREEN_UPLANDS_CORRIDOR_ID,
        financed: false,
      }),
    ),
  );
  const line = built.transmission!.lines.find(
    ({ corridorId }) => corridorId === GREEN_UPLANDS_CORRIDOR_ID,
  )!;
  expect(line).toMatchObject({
    capacityW: 120e6,
    buildCost: 48e6,
    annualOperatingCost: 0.96e6,
    yearsToBuildLeft: 2,
  });
  expect(currentTick(built)!.customers).toBe(customers);
  expect(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: GREEN_UPLANDS_CORRIDOR_ID,
        financed: false,
        tier: 2,
      }),
    ),
  ).toEqual(game);
});
