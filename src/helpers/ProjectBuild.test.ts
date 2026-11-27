import { TERRITORY_TILES } from "../data/TerritoryTiles";
import {
  createTerritoryTileOwnership,
  tileFitsFacility,
} from "./TerritoryTiles";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { GENERATORS, STORAGE } from "../data/Facilities";
import {
  projectReview,
  projectSiteQuote,
  projectSiteCapitalCost,
  projectCatalogue,
  selectProject,
} from "./ProjectBuild";
import { tilePurchaseQuotes } from "./Territories";
import { territoryTileViews } from "./TerritoryMapState";
import cloneDeep from "lodash.clonedeep";
import gameReducer, { buildFacility, tickState } from "../reducers/Game";
import { getDateFromMinute } from "./DateTime";
import { TICK_MINUTES, TICKS_PER_YEAR } from "../Constants";
import { parseSave, serializeSave } from "../SaveGame";
import { validTerritoryNetwork } from "./TerritoryValidation";
import { validUtilityExpansion } from "./ExpansionValidation";
import { facilityConstructionReview } from "./FacilityConstructionReview";

function fixture() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  const project = selectProject(
    GENERATORS(game, 20e6, [], []).find((option) => option.name === "Wind")!,
  );
  return { game, project };
}

it.each([0, 1, 2, 3, 4, 5, 112, 116])(
  "starts authored map %i with two or more connected sites for a normal project",
  (scenarioId) => {
    const game = createGame({ scenarioId, seed: 188 });
    const project = { name: "Wind", fuel: "Wind", peakW: 20e6 } as const;
    const sites = territoryTileViews(game).filter(
      ({ tile, developed, owned }) => {
        if (!developed || !owned) return false;
        const quote = projectSiteQuote(game, project, tile.id);
        return "facility" in quote && quote.connectionCost === 0;
      },
    );
    expect(sites.length).toBeGreaterThanOrEqual(2);
  },
);

it("offers terrain-bounded map catalogue maxima while retaining lower technology limits and off-map sizes", () => {
  const { game } = fixture();
  game.date.year = 2035;
  const generators = projectCatalogue(game, 2e9, false);
  for (const [name, maxPeakW] of [
    ["Solar", 150e6],
    ["Wind", 450e6],
    ["Natural Gas CC", 1000e6],
    ["Biomass", 50e6],
    ["Enhanced Geothermal", 500e6],
  ] as const)
    expect(
      generators.find((facility) => facility.name === name)?.maxPeakW,
    ).toBe(maxPeakW);
  expect(
    projectCatalogue(game, 20e9, true).find(({ name }) => name === "Battery")
      ?.maxPeakWh,
  ).toBe(4e9);
  const offMap = createGame({ scenarioId: 108, seed: 188 });
  expect(
    projectCatalogue(offMap, 2e9, false).find(({ name }) => name === "Wind")
      ?.maxPeakW,
  ).toBe(1500e6);
});
it("can offer the map's hydro ceiling after all owned sites have been commissioned", () => {
  const { game } = fixture();
  const owns = createTerritoryTileOwnership(game);
  game.commissionedHydroSiteIds = TERRITORY_TILES.flatMap((tile) =>
    owns(tile) && tile.hydroSiteId ? [tile.hydroSiteId] : [],
  );
  const hydro = (facilities: ReturnType<typeof GENERATORS>) =>
    facilities.find(({ name }) => name === "Hydro");
  expect(hydro(GENERATORS(game, 100e6, [], []))?.maxPeakW).toBe(0);
  expect(
    projectCatalogue(game, 100e6, false).find(({ name }) => name === "Hydro")!
      .maxPeakW,
  ).toBeGreaterThan(0);
});

it("quotes compatible connected and purchasable sites without spending or changing the project", () => {
  const { game, project } = fixture();
  const cash = currentTick(game)!.cash;
  const owned = projectSiteQuote(game, project, "champlain:site-13");
  const adjacent = projectSiteQuote(game, project, "green-uplands:site-1");
  expect(owned).toMatchObject({
    owned: true,
    connectionCost: 0,
    facility: { name: "Wind", peakW: 20e6 },
  });
  expect(adjacent).toMatchObject({
    owned: false,
    connectionCost: expect.any(Number),
    facility: { name: "Wind", peakW: 20e6 },
  });
  expect(currentTick(game)!.cash).toBe(cash);
  expect(game.territoryNetwork!.tilePurchases).toHaveLength(0);
  expect(project).not.toHaveProperty("buildCost");
});

it("shows the complete terrain-specific capital cost for owned and unconnected candidates", () => {
  const { game } = fixture();
  const project = selectProject(
    GENERATORS(game, 20e6, [], []).find((option) => option.name === "Solar")!,
  );
  const owned = projectSiteQuote(game, project, "champlain:site-13");
  const forest = projectSiteQuote(game, project, "green-uplands:site-1");
  if (!owned.facility || !forest.facility)
    throw new Error("Expected two candidate quotes");
  expect(projectSiteCapitalCost(owned)).toBe(owned.facility.buildCost);
  expect(projectSiteCapitalCost(owned)).toBeGreaterThan(0);
  expect(forest.facility.buildCost).not.toBe(owned.facility.buildCost);
  expect(projectSiteCapitalCost(forest)).toBe(
    forest.facility.buildCost + forest.connectionCost,
  );
  expect(projectSiteCapitalCost(forest)).toBeGreaterThan(forest.connectionCost);
  expect(game.territoryNetwork!.tilePurchases).toHaveLength(0);
});
it("rejects occupied, city, forbidden technology and unquoted distant sites", () => {
  const { game, project } = fixture();
  expect(
    projectSiteQuote(game, project, "champlain:city").facility,
  ).toBeUndefined();
  const occupied = game.facilities.find((facility) => facility.tileId)!;
  expect(
    projectSiteQuote(game, project, occupied.tileId!).facility,
  ).toBeUndefined();
  const quotes = tilePurchaseQuotes(game);
  const unavailable = territoryTileViews(game).filter(
    ({ tile, owned }) =>
      (!owned && !quotes.has(tile.id)) ||
      ["river", "lake", "ocean"].includes(tile.terrain),
  );
  expect(unavailable.length).toBeGreaterThan(0);
  for (const { tile } of unavailable)
    expect(
      projectSiteQuote(game, project, tile.id, quotes).facility,
    ).toBeUndefined();
  const future = { name: "Iron-Air Battery", peakWh: 100e6, peakW: 1e6 };
  expect(
    STORAGE(game, 100e6).some((option) => option.name === future.name),
  ).toBe(false);
  expect(
    projectSiteQuote(game, future, "champlain:site-13").facility,
  ).toBeUndefined();
});
it("combines connection cash with the canonical project loan, and invalidates changed review details", () => {
  const { game, project } = fixture();
  const quote = projectSiteQuote(game, project, "green-uplands:site-1");
  if (!quote.facility) throw new Error(quote.reason);
  const review = projectReview(game, quote, true, 100);
  expect(review.required).toBe(quote.connectionCost + review.terms.amountDue);
  expect(review.remaining).toBeLessThan(0);
  expect(projectReview(game, quote, true, 101).key).not.toBe(review.key);
  expect(projectReview(game, quote, false, 100).key).not.toBe(review.key);
  game.interestRate += 0.01;
  expect(projectReview(game, quote, true, 100).key).not.toBe(review.key);
});

it("keeps hydro, geothermal and offshore projects compatible with their physical site types", () => {
  const { game } = fixture();
  const options = GENERATORS(game, 20e6, [], []);
  for (const name of ["Hydro", "Geothermal", "Offshore Wind"]) {
    const facility = options.find((option) => option.name === name)!;
    expect(facility).toBeDefined();
    const kind =
      name === "Hydro"
        ? "hydro"
        : name === "Geothermal"
          ? "geothermal"
          : "wind";
    const authored = TERRITORY_TILES.find(
      (tile) => tile.siteKind === kind && !tile.city,
    )!;
    const tile =
      name === "Offshore Wind"
        ? { ...authored, terrain: "ocean" as const }
        : authored;
    expect(tileFitsFacility(tile, selectProject(facility))).toBe(true);
  }
});

it("shows the actual reducer completion month for fractional-month construction", () => {
  const { game, project } = fixture();
  game.difficulty = "Manager";
  expect(game.date.month).toBe("Jan");
  const quote = projectSiteQuote(game, project, "champlain:site-13");
  if (!quote.facility) throw new Error(quote.reason);
  const review = projectReview(game, quote, false);
  const state = cloneDeep(
    gameReducer(
      game,
      buildFacility({
        facility: quote.facility,
        financed: false,
        territoryId: quote.tile.territoryId,
        tileId: quote.tile.id,
      }),
    ),
  );
  const built = state.facilities.find(
    ({ tileId }) => tileId === quote.tile.id,
  )!;
  expect(built).toBeDefined();
  for (
    let tick = 0;
    tick < TICKS_PER_YEAR && built.yearsToBuildLeft > 0;
    tick++
  )
    tickState(state);
  expect(built.yearsToBuildLeft).toBe(0);
  const actual = getDateFromMinute(
    built.minuteOperational!,
    state.startingYear,
  );
  expect(actual.month).toBe("Sep");
  expect(review.online).toMatchObject({
    month: actual.month,
    year: actual.year,
  });
});

it.each([
  ["Facility", 20e6, false],
  ["Connection", 10e3, true],
] as const)(
  "%s finishes last when both jobs start together",
  (last, peakW, financed) => {
    const game = createGame({
      scenarioId: 116,
      seed: 188,
      difficulty: "Intern",
    });
    currentTick(game)!.cash = 1e9;
    const option = GENERATORS(game, peakW, [], []).find(
      ({ name }) => name === "Wind",
    );
    const quote = projectSiteQuote(
      game,
      selectProject(option!),
      "green-uplands:site-1",
    );
    if (!quote.facility || !quote.connection) throw new Error(quote.reason);
    const review = projectReview(game, quote, financed);
    const facilityOnly = facilityConstructionReview(
      game,
      quote.facility,
      financed,
      quote.tile.id,
    );
    const connects = quote.connection.connectionMinute;
    const lineFinishesLast = last === "Connection";
    expect(connects > facilityOnly.online.minute).toBe(lineFinishesLast);
    expect(review.online.minute).toBe(
      Math.max(connects, facilityOnly.online.minute),
    );
    const order = {
      facility: quote.facility,
      financed,
      territoryId: quote.tile.territoryId,
      tileId: quote.tile.id,
      connectionQuoteKey: quote.connection.quoteKey,
      reviewKey: review.buildKey,
    };
    const underfunded = cloneDeep(game);
    currentTick(underfunded)!.cash = review.required - 1;
    expect(gameReducer(underfunded, buildFacility(order))).toBe(underfunded);
    expect(
      gameReducer(game, buildFacility({ ...order, reviewKey: "stale" })),
    ).toBe(game);
    const accepted = gameReducer(game, buildFacility(order));
    expect(currentTick(game)!.cash - currentTick(accepted)!.cash).toBeCloseTo(
      review.required,
      5,
    );
    expect(accepted.territoryNetwork?.tilePurchases).toEqual([
      expect.objectContaining({
        tileId: quote.tile.id,
        minute: game.date.minute,
        connectionMinute: connects,
      }),
    ]);
    const started = accepted.facilities.find(
      (plant) => plant.tileId === quote.tile.id,
    )!;
    expect(started).toMatchObject({
      minuteCreated: game.date.minute,
      yearsToBuildLeft: quote.facility.yearsToBuild,
    });
    expect(started.loanAmountTotal).toBe(review.terms.loanAmount);
    expect(gameReducer(accepted, buildFacility(order))).toBe(accepted);
    expect(parseSave(serializeSave(game))).not.toBeNull();
    expect(validTerritoryNetwork(accepted)).toBe(true);
    expect(validUtilityExpansion(accepted)).toBe(true);
    const decoded = parseSave(
      JSON.parse(JSON.stringify(serializeSave(accepted))),
    );
    expect(decoded).not.toBeNull();
    const restored = decoded!.game;
    const state = cloneDeep(restored);
    const plant = state.facilities.find(({ id }) => id === started.id)!;
    while (state.date.minute < connects - TICK_MINUTES) tickState(state);
    expect(plant.minuteOperational).toBeUndefined();
    expect(plant.currentW).toBe(0);
    const savedBeforeConnection = parseSave(
      JSON.parse(JSON.stringify(serializeSave(state))),
    );
    expect(savedBeforeConnection).not.toBeNull();
    expect(
      plant.constructionKgco2eEmitted === plant.constructionKgco2eTotal,
    ).toBe(lineFinishesLast);
    tickState(state);
    expect(plant.minuteOperational).toBe(
      lineFinishesLast ? connects : undefined,
    );
    while (
      plant.yearsToBuildLeft > 0 &&
      state.date.minute <= facilityOnly.online.minute
    )
      tickState(state);
    const opening = getDateFromMinute(
      plant.minuteOperational!,
      state.startingYear,
    );
    expect(opening).toMatchObject({
      month: review.online.month,
      year: review.online.year,
    });
    expect(plant.yearsToBuildLeft).toBe(0);
    expect(plant.minuteOperational).toBeLessThan(
      facilityOnly.online.minute + (connects - game.date.minute),
    );
  },
);
