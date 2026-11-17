import { TERRITORY_TILES } from "../data/TerritoryTiles";
import { tileFitsFacility } from "./TerritoryTiles";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { GENERATORS, STORAGE } from "../data/Facilities";
import { projectReview, projectSiteQuote, selectProject } from "./ProjectBuild";
import { tilePurchaseQuotes } from "./Territories";
import { territoryTileViews } from "./TerritoryMapState";
import cloneDeep from "lodash.clonedeep";
import gameReducer, { buildFacility, tickState } from "../reducers/Game";
import { getDateFromMinute } from "./DateTime";
import { TICKS_PER_YEAR } from "../Constants";

function fixture() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  const project = selectProject(
    GENERATORS(game, 20e6, [], []).find((option) => option.name === "Wind")!,
  );
  return { game, project };
}
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
