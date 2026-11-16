import { getBuildFacilityQuote } from "../data/Facilities";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import { currentTick } from "../helpers/GameSelectors";
import { purchaseTerms } from "../helpers/Financials";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { applyCommand, createWorld } from "./World";

it.each(["Wind", "Offshore Wind"] as const)(
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
        (name === "Offshore Wind"
          ? tile.terrain === "ocean"
          : tile.terrain === "mountain"),
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
