/** Run via npm run perf:bench -- --valley. Use the authoritative multiplayer world. */
import "../Store";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { TextEncoder } from "node:util";
import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES, TICKS_PER_MONTH } from "../Constants";
import { getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import { getScenario } from "../data/Scenarios";
import { getTerritoryDefinition } from "../data/Territories";
import { territoryTileAt } from "../data/TerritoryTiles";
import { copyCommitmentMetadata } from "../helpers/Commitment";
import { expansionRetentionBaseline } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { getScenarioLocation } from "../helpers/Locations";
import { rebaseGameRetentionBaseline } from "../helpers/ObjectiveRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { landCustomerMarket } from "../helpers/TerritoryCustomers";
import { tilePrice } from "../helpers/Territories";
import {
  isGeneralBuildingLand,
  ownedTerritoryTiles,
  territoryTilePowerLimit,
} from "../helpers/TerritoryTiles";
import { canonicalWorldBytes } from "../multiplayer/Replication";
import type { Command, World } from "../multiplayer/Types";
import { applyCommand, createWorld, stepWorld } from "../multiplayer/World";
import { generateNewTimeline } from "../reducers/Game";
import type { FacilityShoppingType } from "../Types";
import { coopSeats } from "./MultiplayerFixtures";
import { loadSimData } from "./SimData";

jest.setTimeout(600000);
type Tile = NonNullable<ReturnType<typeof territoryTileAt>>;

function send(world: World, seat: string, command: Command) {
  const error = applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command,
  });
  if (error)
    throw new Error(`Seat ${seat}: ${JSON.stringify(command)}: ${error}`);
}

// Preserve the production geography and catalogue. The board has too few
// cities and Burlington has no purchasable pumped storage sites. Seed the
// same generated land receipts and catalogue storage economics as an existing
// holding, before timing any ticks.
function retainedSites(
  seat: number,
  benefit: "industrial" | "hydro" | "general",
  limit: number,
): Tile[] {
  const tiles: Tile[] = [];
  for (
    let q = 10 + seat * 64;
    q < 74 + seat * 64 && tiles.length < limit;
    q++
  ) {
    for (let r = -40; r <= 40 && tiles.length < limit; r++) {
      const tile = territoryTileAt(q, r);
      if (tile && getTerritoryDefinition(tile.territoryId)?.benefit === benefit)
        tiles.push(tile);
    }
  }
  if (tiles.length !== limit)
    throw new Error(`Missing ${benefit} sites for seat ${seat}`);
  return tiles;
}

function construct(
  world: World,
  index: number,
  request: Partial<FacilityShoppingType>,
  tile: Tile,
) {
  const game = world.grids[index];
  const facility = getBuildFacilityQuote(
    game,
    request,
    tile.territoryId,
    tile.id,
  );
  if (!facility) throw new Error(`No ${request.name} quote at ${tile.id}`);
  send(world, world.seats[index].id, {
    kind: "action",
    name: "buildFacility",
    payload: {
      facility,
      financed: false,
      territoryId: tile.territoryId,
      tileId: tile.id,
    },
  });
  const grid = world.grids[index];
  const installed = grid.facilities.find((f) => f.tileId === tile.id)!;
  installed.yearsToBuildLeft = 0;
  installed.minuteOperational = 0;
  installed.constructionKgco2eEmitted = installed.constructionKgco2eTotal;
  if (installed.hydroSiteId)
    grid.commissionedHydroSiteIds.push(installed.hydroSiteId);
}

function fixture() {
  const world = createWorld(
    { scenarioId: 116, difficulty: "Intern" },
    coopSeats(4),
    "valley-benchmark",
    "initial",
  );
  for (const [i, opening] of world.grids.entries()) {
    const homeTiles = ownedTerritoryTiles(opening);
    const cities = retainedSites(i, "industrial", 3);
    const [hydro] = retainedSites(i, "hydro", 1);
    const additionalLand = retainedSites(
      i,
      "general",
      20 - homeTiles.length - 4,
    );
    opening.territoryNetwork!.tilePurchases = [
      ...cities,
      hydro,
      ...additionalLand,
    ].map(({ id }) => ({
      tileId: id,
      minute: 0,
      price: tilePrice(opening, 0, id),
      legacy: true,
    }));
    const oldBaseline = expansionRetentionBaseline(opening);
    opening.customerMarketSize = 72000 + landCustomerMarket(opening);
    rebaseGameRetentionBaseline(opening, oldBaseline);
    // Start with a stable served load and operating plants. Benchmark timing
    // excludes transactions, construction and all initial forecast generation.
    for (const tick of opening.timeline) {
      tick.cash = 1.5e9;
      tick.customers = 36000 + oldBaseline - 90000;
    }
    opening.facilities = opening.facilities.filter((f) => f.fuel === "Hydro");
    const general = homeTiles.filter(isGeneralBuildingLand);
    const wind = { name: "Wind", fuel: "Wind", peakW: 350e6 } as const;
    const solar = { name: "Solar", fuel: "Sun", peakW: 150e6 } as const;
    const windTile = general.find(
      (tile) => territoryTilePowerLimit(tile, wind) >= wind.peakW,
    )!;
    const solarTile = general.find(
      (tile) =>
        tile.id !== windTile.id &&
        territoryTilePowerLimit(tile, solar) >= solar.peakW,
    )!;
    construct(world, i, { name: "Hydro", fuel: "Hydro", peakW: 20e6 }, hydro);
    construct(world, i, wind, windTile);
    construct(world, i, solar, solarTile);
    const game = world.grids[i];
    const [first, second] = general.filter(
      ({ id }) => id !== windTile.id && id !== solarTile.id,
    );
    for (const tile of [first, second]) {
      const storageMarket = {
        ...game,
        location: { ...game.location, id: "Denver" },
      };
      const quote = STORAGE(
        storageMarket,
        1.2e9,
        tile.id,
        tile.territoryId,
      ).find(({ name }) => name === "Pumped Hydro")!;
      const { viableLocationsRemaining: _remaining, ...project } = quote;
      game.facilities.push({
        ...project,
        available: true,
        id: Math.max(...game.facilities.map(({ id }) => id)) + 1,
        territoryId: tile.territoryId,
        tileId: tile.id,
        yearsToBuildLeft: 0,
        minuteCreated: 0,
        minuteOperational: 0,
        currentW: 0,
        currentWh: quote.peakWh / 2,
        loanAmountTotal: 0,
        loanAmountLeft: 0,
        loanMonthlyPayment: 0,
        interestRate: 0,
        lifetimeWh: 0,
        lifetimePotentialWh: 0,
        lifetimeRevenue: 0,
        lifetimeExpenses: 0,
      });
    }
    const start = currentTick(game)!;
    game.timeline = generateNewTimeline(game, start.cash, start.customers);
    send(world, world.seats[i].id, { kind: "ready" });
  }
  for (const game of world.grids) {
    const tiles = ownedTerritoryTiles(game);
    expect(tiles).toHaveLength(20);
    expect(new Set(tiles.map(({ territoryId }) => territoryId)).size).toBe(5);
    expect(tiles.filter((tile) => tile.city)).toHaveLength(4);
    expect(game.facilities.map((facility) => facility.name).sort()).toEqual([
      "Hydro",
      "Hydro",
      "Pumped Hydro",
      "Pumped Hydro",
      "Solar",
      "Wind",
    ]);
    expect(
      game.facilities.every((facility) => facility.yearsToBuildLeft === 0),
    ).toBe(true);
    expect(
      game.facilities.every(({ tileId }) =>
        tiles.some(({ id }) => id === tileId),
      ),
    ).toBe(true);
  }
  return world;
}

function copyFixture(initial: World) {
  const world = cloneDeep(initial);
  initial.grids.forEach((grid, i) =>
    grid.timeline.forEach((tick, j) =>
      copyCommitmentMetadata(tick, world.grids[i].timeline[j]),
    ),
  );
  return world;
}

function answerChoices(world: World) {
  for (const [i, seat] of world.seats.entries()) {
    const choice = pendingScenarioChoice(world.grids[i]);
    if (choice)
      send(world, seat.id, {
        kind: "action",
        name: "chooseScenarioResponse",
        payload: { decisionId: choice.id, optionId: choice.options[0].id },
      });
  }
}

function quantile(samples: number[], fraction: number) {
  return [...samples].sort((a, b) => a - b)[
    Math.ceil(samples.length * fraction) - 1
  ];
}

function play(initial: World, months: number, verify: boolean) {
  const world = copyFixture(initial);
  global.gc!();
  let userAndSystemMicros = 0;
  let tickWallMs = 0;
  const rolloverMs: number[] = [];
  const checkpoints: string[] = [];
  const frames = verify ? createHash("sha256") : undefined;
  for (let month = 0; month < months; month++) {
    const beforeMonth = process.cpuUsage();
    let choiceMicros = 0;
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) {
      if (world.paused) {
        const choiceStart = process.cpuUsage();
        answerChoices(world);
        const choice = process.cpuUsage(choiceStart);
        choiceMicros += choice.user + choice.system;
      }
      const started = performance.now();
      stepWorld(world);
      const tickElapsed = performance.now() - started;
      tickWallMs += tickElapsed;
      if (tick === TICKS_PER_MONTH - 1) rolloverMs.push(tickElapsed);
      if (frames) {
        // Keep every visible current frame and live ledger in the fingerprint.
        // Full checkpoints below also cover the forecast horizon and history.
        frames.update(
          canonicalWorldBytes({
            ...world,
            rules: "valley-benchmark",
            grids: world.grids.map((game) => ({
              ...game,
              timeline: [currentTick(game)!],
              monthlyHistory: [],
              eventLog: [],
            })),
          }),
        );
      }
    }
    const cpu = process.cpuUsage(beforeMonth);
    userAndSystemMicros += cpu.user + cpu.system - choiceMicros;
    if (
      Object.keys(world.outcomes).length ||
      world.grids.some(
        (g) => g.date.minute !== (month + 1) * TICKS_PER_MONTH * TICK_MINUTES,
      )
    )
      throw new Error(
        `Co-op stopped before month ${month + 1}: ${world.reason} ${JSON.stringify(world.outcomes)}`,
      );
    if (verify) {
      // The binary identity changes whenever game source changes. Compare the
      // exact remaining replica payload, including commitments and all history.
      checkpoints.push(
        createHash("sha256")
          .update(canonicalWorldBytes({ ...world, rules: "valley-benchmark" }))
          .digest("hex"),
      );
    }
  }
  return {
    cpuMsPerMonth: userAndSystemMicros / 1000 / months,
    wallMsPerMonth: tickWallMs / months,
    rolloverMs,
    checkpoints,
    frameDigest: frames?.digest("hex"),
  };
}

it("benchmarks a four-company Valley with 20 tiles, four cities and six plants per company", () => {
  const months = Number(process.env.PERF_MONTHS ?? 12);
  const repetitions = Number(process.env.PERF_RUNS ?? 3);
  if (!global.gc) throw new Error("Run through perf:bench with --expose-gc");
  Object.assign(globalThis, { TextEncoder });
  loadSimData(getScenarioLocation(getScenario(116))!);
  const world = fixture();
  const verified = play(world, months, true);
  const samples = Array.from({ length: repetitions }, () =>
    play(world, months, false),
  );
  const rollover = samples.flatMap((sample) => sample.rolloverMs);
  writeFileSync(
    process.env.PERF_RESULT_FILE!,
    JSON.stringify({
      players: world.seats.length,
      territoriesPerPlayer: 5,
      tilesPerPlayer: 20,
      citiesPerPlayer: 4,
      facilitiesPerPlayer: world.grids[0].facilities.map(
        ({ name, peakW, peakWh }) => ({ name, peakW, peakWh }),
      ),
      months,
      ticksPerMonth: TICKS_PER_MONTH,
      cpuMsPerMonth: quantile(
        samples.map((sample) => sample.cpuMsPerMonth),
        0.5,
      ),
      wallMsPerMonth: quantile(
        samples.map((sample) => sample.wallMsPerMonth),
        0.5,
      ),
      rolloverMedianMs: quantile(rollover, 0.5),
      rolloverP95Ms: quantile(rollover, 0.95),
      frameDigest: verified.frameDigest,
      checkpoints: verified.checkpoints,
      samples: samples.map(
        ({ checkpoints: _checkpoints, frameDigest: _frameDigest, ...sample }) =>
          sample,
      ),
    }),
  );
});
