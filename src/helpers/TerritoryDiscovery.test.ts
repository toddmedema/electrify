import cloneDeep from "lodash.clonedeep";
import { GENERATORS } from "../data/Facilities";
import {
  frontierCoordinates,
  getTerritoryDefinition,
  territoryHydroSiteId,
} from "../data/Territories";
import {
  TERRITORY_TILES,
  VALLEY_BOARD,
  territoryTileAt,
} from "../data/TerritoryTiles";
import { validHydroClaims } from "../data/HydroSites";
import { parseSave, serializeSave } from "../SaveGame";
import reducer, { buildFacility, tickState } from "../reducers/Game";
import { acquireTile } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import type { GameType, TerritoryTileId } from "../Types";
import { currentTick } from "./GameSelectors";
import { acceptAgreement, powerAgreementQuote } from "./PowerAgreements";
import {
  tilePrice,
  tilePurchaseQuote,
  tilePurchaseQuotes,
  purchaseTile,
  territoryBuildAvailability,
  territoryDemandByType,
  landTransferredCustomers,
} from "./Territories";
import {
  getTerritoryTile,
  ownsTerritoryTile,
  territoryVisibilityDistance,
  visibleTerritoryTiles,
  territoryHexDistance,
} from "./TerritoryTiles";
import { validTerritoryNetwork } from "./TerritoryValidation";
import { acquisitionQuote, transferUtility } from "./Expansion";

function ready() {
  const game = createGame({ scenarioId: 116, seed: 61 });
  currentTick(game)!.cash = 3e9;
  return game;
}
function buy(game: GameType, tileId: TerritoryTileId) {
  const quote = tilePurchaseQuote(game, tileId)!;
  expect(quote).toBeDefined();
  const next = cloneDeep(
    reducer(game, acquireTile({ tileId, quoteKey: quote.quoteKey })),
  );
  expect(ownsTerritoryTile(next, tileId)).toBe(true);
  Object.assign(game, next);
  return quote;
}
/** Buy a visible path toward a target through the same public purchase owner. */
function reveal(game: GameType, target: { q: number; r: number }) {
  const distance = (tile: { q: number; r: number }) =>
    territoryHexDistance(tile, target);
  for (let step = 0; step < 40; step++) {
    const tile = territoryTileAt(target.q, target.r)!;
    if (tilePurchaseQuote(game, tile.id) || ownsTerritoryTile(game, tile))
      return tile;
    const candidates = [...tilePurchaseQuotes(game).keys()]
      .map((id) => getTerritoryTile(id, game)!)
      .sort((a, b) => distance(a) - distance(b));
    expect(candidates.length).toBeGreaterThan(0);
    buy(game, candidates[0].id);
  }
  throw new Error("Did not reveal target");
}
it.each([
  "frontier:-0:2",
  "frontier:01:2",
  "frontier:1.5:2",
  "frontier:1e2:0",
  "frontier:NaN:0",
  "frontier:9007199254740992:0",
  "frontier:1:2:3",
])("rejects noncanonical or unsafe coordinate %s", (id) => {
  expect(frontierCoordinates(id)).toBeUndefined();
  expect(getTerritoryTile(id)).toBeUndefined();
});
it("generates stable terrain and benefits at far finite coordinates, independently of weather seeds", () => {
  const id = "frontier:1000000:-2000000";
  expect(getTerritoryTile(id)).toEqual(getTerritoryTile(id, ready()));
  expect(getTerritoryDefinition(id)).toEqual(getTerritoryDefinition(id));
  expect(getTerritoryTile(id)).toMatchObject({
    q: 1000000,
    r: -2000000,
    territoryId: id,
  });
  expect(getTerritoryTile("frontier:-4:-4")).toBeUndefined(); // authored home cell
});
it("purchases one visible frontier cell and reveals exactly three more rings without remote buying", () => {
  const game = ready();
  expect(tilePurchaseQuote(game, "frontier:-10:-3")).toBeUndefined();
  const before = JSON.stringify(game);
  expect(
    purchaseTile(game, {
      tileId: "frontier:-10:-3",
      quoteKey: JSON.stringify([
        "frontier:-10:-3",
        0,
        tilePrice(game, 0, "frontier:-10:-3"),
      ]),
    }),
  ).toBe(false);
  expect(JSON.stringify(game)).toBe(before);
  buy(game, "frontier:-5:-3");
  expect(
    territoryVisibilityDistance(game, getTerritoryTile("frontier:-8:-3")!),
  ).toBe(3);
  expect(
    territoryVisibilityDistance(game, getTerritoryTile("frontier:-9:-3")!),
  ).toBeUndefined();
  expect(
    visibleTerritoryTiles(game).every(
      ({ visibilityDistance }) => visibilityDistance <= 3,
    ),
  ).toBe(true);
  expect(game.territoryNetwork!.tilePurchases).toHaveLength(1);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(visibleTerritoryTiles(restored)).toEqual(visibleTerritoryTiles(game));
});
it("uses active dated utility PPAs as anchors and removes them on expiry, while acquired cells keep sight", () => {
  const game = ready();
  const remote = getTerritoryTile("frontier:7:-4")!;
  expect(territoryVisibilityDistance(game, remote)).toBeUndefined();
  const offer = powerAgreementQuote(game, "valley-purchase", 3)!;
  expect(
    acceptAgreement(game, { blockId: offer.id, quoteKey: offer.quoteKey }),
  ).toBe(true);
  expect(territoryVisibilityDistance(game, remote)).toBe(3);
  expect(tilePurchaseQuote(game, remote.id)).toBeUndefined();
  const expired = cloneDeep(game);
  expired.date.minute = offer.receipt.endMinute;
  expect(territoryVisibilityDistance(expired, remote)).toBeUndefined();
  const acquisition = acquisitionQuote(game, "valley-electric")!;
  expect(
    transferUtility(game, {
      targetId: "valley-electric",
      financed: false,
      quoteKey: acquisition.quoteKey,
    }),
  ).toBe(true);
  const adjacent = getTerritoryTile("frontier:5:-4")!;
  buy(game, adjacent.id);
  game.date.minute = offer.receipt.endMinute;
  expect(territoryVisibilityDistance(game, adjacent)).toBe(0);
});
it("does not grant neighboring authored sites, duplicate cash or customer credit", () => {
  const game = ready();
  const first = buy(game, "green-uplands:site-0");
  expect(first.price).toBeCloseTo(18e6 / 7, 5);
  expect(ownsTerritoryTile(game, "green-uplands:site-1")).toBe(false);
  const wind = GENERATORS(
    game,
    50e6,
    [20],
    [500],
    [],
    [],
    "green-uplands",
  ).find(({ name }) => name === "Wind")!;
  expect(
    territoryBuildAvailability(
      game,
      wind,
      "green-uplands",
      "green-uplands:site-1",
    ).buildable,
  ).toBe(false);
  const after = JSON.stringify(game);
  expect(
    purchaseTile(game, { tileId: first.tileId, quoteKey: first.quoteKey }),
  ).toBe(false);
  expect(JSON.stringify(game)).toBe(after);
  const city = reveal(game, { q: 1, r: 3 });
  if (!city.city) throw new Error("Expected authored industrial city");
  const customers = currentTick(game)!.customers;
  const quote = buy(game, city.id);
  expect(currentTick(game)!.customers).toBe(customers + quote.customers);
  expect(landTransferredCustomers(game, city.territoryId)).toBe(
    quote.customers,
  );
  const cash = currentTick(game)!.cash;
  expect(
    purchaseTile(game, { tileId: city.id, quoteKey: quote.quoteKey }),
  ).toBe(false);
  expect(currentTick(game)!.cash).toBe(cash);
  expect(currentTick(game)!.customers).toBe(customers + quote.customers);
});
function generatedTarget(benefit: string) {
  const tile = VALLEY_BOARD.find(
    (candidate) =>
      candidate.id.startsWith("frontier:") &&
      getTerritoryDefinition(candidate.territoryId)?.benefit === benefit,
  );
  if (!tile) throw new Error(`Missing generated ${benefit} fixture`);
  return tile;
}
function expectDeterministicResume(game: GameType) {
  expect(validTerritoryNetwork(game)).toBe(true);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  tickState(game);
  tickState(restored);
  expect(JSON.parse(JSON.stringify(restored))).toEqual(
    JSON.parse(JSON.stringify(game)),
  );
}
it.each(["general", "hydro", "geothermal"] as const)(
  "generated %s cells build through the real bounded resource owners",
  (benefit) => {
    let game = ready();
    const target = generatedTarget(benefit);
    reveal(game, target);
    buy(game, target.id);
    const name =
      benefit === "hydro"
        ? "Hydro"
        : benefit === "geothermal"
          ? "Geothermal"
          : "Wind";
    const facility = GENERATORS(
      game,
      20e6,
      [20],
      [500],
      [],
      [],
      target.territoryId,
      target.id,
    ).find((entry) => entry.name === name)!;
    expect(facility.available).toBe(true);
    expect(
      territoryBuildAvailability(game, facility, target.territoryId, target.id)
        .buildable,
    ).toBe(true);
    game = cloneDeep(
      reducer(
        game,
        buildFacility({
          facility,
          financed: false,
          territoryId: target.territoryId,
          tileId: target.id,
        }),
      ),
    );
    const built = game.facilities.find(({ tileId }) => tileId === target.id)!;
    expect(built).toBeDefined();
    expect(built.hydroSiteId).toBe(
      benefit === "hydro"
        ? territoryHydroSiteId(target.territoryId)
        : undefined,
    );
    expect(validHydroClaims(game)).toBe(true);
    expect(
      territoryBuildAvailability(game, facility, target.territoryId, target.id)
        .buildable,
    ).toBe(false);
    const forged = JSON.parse(JSON.stringify(serializeSave(game)));
    forged.game.facilities.find(
      (entry: { tileId?: string }) => entry.tileId === target.id,
    ).peakW = benefit === "general" ? 0 : 1e9;
    expect(parseSave(forged)).toBeNull();
    expectDeterministicResume(game);
  },
);
it.each(["residential", "industrial"] as const)(
  "authored %s cities use the sector customer owner once",
  (benefit) => {
    const game = ready();
    const target = getTerritoryTile(
      benefit === "residential" ? "parcel-1:city" : "parcel-11:city",
    )!;
    reveal(game, target);
    const offer = buy(game, target.id);
    expect(offer.customers).toBeGreaterThan(0);
    expect(
      territoryDemandByType(game, currentTick(game)!, target.territoryId)[
        benefit === "residential" ? "Residential" : "Industrial"
      ],
    ).toBeGreaterThan(0);
    expectDeterministicResume(game);
  },
);
it("schema16 whole parcels keep every paid cell, capital, facilities and financial history", () => {
  const game = ready();
  game.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: 18e6,
  });
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 16;
  delete raw.game.territoryNetwork.legacyTiles;
  delete raw.game.territoryNetwork.tilePurchases;
  const restored = parseSave(raw)!.game;
  expect(restored.territoryNetwork!.landPurchases).toEqual(
    raw.game.territoryNetwork.landPurchases,
  );
  expect(
    TERRITORY_TILES.filter(
      ({ territoryId }) => territoryId === "green-uplands",
    ).every((tile) => ownsTerritoryTile(restored, tile)),
  ).toBe(true);
  for (const field of [
    "timeline",
    "monthlyHistory",
    "facilities",
    "date",
    "customerMarketSize",
  ] as const)
    expect(JSON.parse(JSON.stringify(restored[field]))).toEqual(
      JSON.parse(JSON.stringify(game[field])),
    );
  const forged = cloneDeep(raw);
  forged.schemaVersion = 17;
  forged.game.territoryNetwork.tilePurchases = [
    {
      tileId: "frontier:1000000:0",
      minute: 0,
      price: tilePrice(game, 0, "frontier:1000000:0"),
    },
  ];
  expect(parseSave(forged)).toBeNull();
});

it.each([
  null,
  [null],
  [{}],
  [{ tileId: "frontier:-0:2", minute: 0, price: 3e6 }],
])("rejects malformed physical receipts %p without throwing", (receipts) => {
  const raw = JSON.parse(JSON.stringify(serializeSave(ready())));
  raw.game.territoryNetwork.tilePurchases = receipts;
  expect(() => parseSave(raw)).not.toThrow();
  expect(parseSave(raw)).toBeNull();
});
