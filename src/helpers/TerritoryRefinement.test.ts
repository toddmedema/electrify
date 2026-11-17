import cloneDeep from "lodash.clonedeep";
import { GENERATORS } from "../data/Facilities";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import reducer from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { acceptAgreement, powerAgreementQuote } from "./PowerAgreements";
import {
  tilePurchaseQuote,
  tilePurchaseQuotes,
  territoryBuildAvailability,
} from "./Territories";
import {
  getTerritoryTile,
  tileFitsFacility,
  territoryVisibilityDistance,
} from "./TerritoryTiles";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 3e9;
  return game;
}

it("quotes only neutral cells touching physical owned land, while sight extends three rings", () => {
  const game = ready();
  const distant = getTerritoryTile("frontier:-7:-3")!;
  expect(territoryVisibilityDistance(game, distant)).toBe(3);
  expect(tilePurchaseQuote(game, distant.id)).toBeUndefined();
  expect(tilePurchaseQuotes(game).has(distant.id)).toBe(false);
  const before = JSON.stringify(game);
  const forgedQuote = JSON.stringify([distant.id, 3e6, "general", 0]);
  expect(
    JSON.stringify(
      reducer(game, acquireTile({ tileId: distant.id, quoteKey: forgedQuote })),
    ),
  ).toBe(before);
  const adjacent = tilePurchaseQuote(game, "frontier:-5:-3")!;
  expect(adjacent).toBeDefined();
  const expanded = cloneDeep(
    reducer(
      game,
      acquireTile({ tileId: adjacent.tileId, quoteKey: adjacent.quoteKey }),
    ),
  );
  expect(tilePurchaseQuote(expanded, "frontier:-6:-3")).toBeDefined();
});

it("does not turn a PPA visibility anchor into physical purchase adjacency", () => {
  const game = ready();
  const offer = powerAgreementQuote(game, "valley-purchase", 3)!;
  expect(
    acceptAgreement(game, { blockId: offer.id, quoteKey: offer.quoteKey }),
  ).toBe(true);
  const remote = getTerritoryTile("frontier:5:-4")!;
  expect(territoryVisibilityDistance(game, remote)).toBe(1);
  expect(tilePurchaseQuote(game, remote.id)).toBeUndefined();
});

it("leaves general sites uncapped while named sites keep their physical power limit", () => {
  const game = ready();
  const tile = getTerritoryTile("green-uplands:site-0")!;
  game.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  const wind = GENERATORS(
    game,
    500e6,
    [20],
    [500],
    [],
    [],
    "green-uplands",
    tile.id,
  ).find(({ name }) => name === "Wind")!;
  expect(tileFitsFacility(tile, wind)).toBe(true);
  expect(
    territoryBuildAvailability(game, wind, "green-uplands", tile.id),
  ).toMatchObject({ buildable: true, maxPeakW: Infinity });
  const named = TERRITORY_TILES.find((entry) => entry.siteKind === "wind")!;
  expect(tileFitsFacility(named, wind)).toBe(false);
});

it("classifies the inland authored water cell as a lake and rejects new offshore construction there", () => {
  const lake = getTerritoryTile("champlain:site-14")!;
  expect(lake.terrain).toBe("lake");
  expect(tileFitsFacility(lake, { fuel: "Offshore Wind", peakW: 20e6 })).toBe(
    false,
  );
});
