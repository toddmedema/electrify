import { getBuildFacilityQuote } from "../data/Facilities";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import { facilityConstructionReview } from "../helpers/FacilityConstructionReview";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { availableTerritoryTiles } from "../helpers/TerritoryTiles";
import { currentTick } from "../helpers/GameSelectors";
import { purchaseTerms } from "../helpers/Financials";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { applyCommand, createWorld } from "./World";

it.each(["Wind"] as const)(
  "host charges one canonical selected-site %s price despite an edited client quote",
  (name) => {
    loadSimData(UTILITY_AREAS.champlain.location);
    const world = createWorld(
      { scenarioId: 116, difficulty: "Employee" },
      coopSeats(2),
      "terrain-cost",
      "epoch",
    );
    const game = world.grids[0];
    const tileId = TERRITORY_TILES.find(
      (tile) =>
        tile.territoryId === "champlain" &&
        tile.siteKind === "wind" &&
        !tile.startingAssetId &&
        tile.terrain === "mountain",
    )!.id;
    const quote = getBuildFacilityQuote(
      game,
      { name, peakW: 20e6 },
      "champlain",
      tileId,
    )!;
    expect(quote).toBeDefined();
    const cash = currentTick(game)!.cash;
    const terms = purchaseTerms(quote.buildCost, true, game.interestRate);
    expect(
      applyCommand(world, "0", {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: 1,
        command: {
          kind: "action",
          name: "buildFacility",
          payload: {
            territoryId: "champlain",
            tileId,
            financed: true,
            facility: { name, peakW: 20e6, buildCost: 1, yearsToBuild: 0 },
          },
        },
      }),
    ).toBeUndefined();
    const built = world.grids[0].facilities.find(
      (facility) => facility.tileId === tileId,
    )!;
    expect(built.buildCost).toBe(quote.buildCost);
    expect(built.yearsToBuildLeft).toBe(quote.yearsToBuild);
    expect(built.loanAmountTotal).toBe(terms.loanAmount);
    expect(currentTick(world.grids[0])!.cash).toBe(cash - terms.amountDue);
  },
);

it("host rejects new offshore construction on the inland lake before spending any cash", () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "lake",
    "epoch",
  );
  const before = JSON.stringify(world.grids);
  expect(
    applyCommand(world, "0", {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: 1,
      command: {
        kind: "action",
        name: "buildFacility",
        payload: {
          territoryId: "champlain",
          tileId: "champlain:site-14",
          financed: false,
          facility: { name: "Offshore Wind", peakW: 20e6, available: true },
        },
      },
    }),
  ).toBeDefined();
  expect(JSON.stringify(world.grids)).toBe(before);
});

it("requires a fresh construction review after host pricing changes", () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    coopSeats(2),
    "reviewed-construction",
    "epoch",
  );
  const game = world.grids[0];
  const request = { name: "Battery" as const, peakWh: 100e6 };
  game.date = getDateFromMinute(191 * MINUTES_PER_MONTH, game.startingYear);
  const preview = getBuildFacilityQuote(game, request)!;
  const tile = availableTerritoryTiles(game, preview, "champlain")[0];
  const quote = getBuildFacilityQuote(game, request, "champlain", tile.id)!;
  const reviewed = facilityConstructionReview(game, quote, false, tile.id);
  game.date = getDateFromMinute(192 * MINUTES_PER_MONTH, game.startingYear);
  const newQuote = getBuildFacilityQuote(game, request, "champlain", tile.id)!;
  expect(newQuote.buildCost).not.toBe(quote.buildCost);
  const fresh = facilityConstructionReview(game, newQuote, false, tile.id);
  currentTick(game)!.cash = 1e9;
  const before = JSON.stringify(game);
  const build = (sequence: number, reviewKey: string) =>
    applyCommand(world, "0", {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence,
      command: {
        kind: "action",
        name: "buildFacility",
        payload: {
          territoryId: "champlain",
          tileId: tile.id,
          financed: false,
          facility: request,
          reviewKey,
        },
      },
    });
  expect(build(1, reviewed.key)).toMatch(/terms changed/);
  expect(JSON.stringify(world.grids[0])).toBe(before);
  expect(build(2, fresh.key)).toBeUndefined();
  expect(
    world.grids[0].facilities.find(({ tileId }) => tileId === tile.id),
  ).toMatchObject({ name: request.name, buildCost: newQuote.buildCost });
});
