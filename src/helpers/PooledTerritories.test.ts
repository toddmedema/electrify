import { createGame } from "../testing/Simulator";
import { loadSimData } from "../testing/SimData";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { acquisitionQuote, transferUtility } from "./Expansion";
import { currentTick } from "./GameSelectors";
import { territoryBuildAvailability } from "./Territories";
import { GENERATORS } from "../data/Facilities";

beforeAll(() => loadSimData(UTILITY_AREAS.champlain.location));

it("acquires and builds in a neighboring utility without a line", () => {
  const game = createGame({ scenarioId: 116, seed: 61 });
  game.transmission!.lines = [];
  currentTick(game)!.cash = 1e9;
  const quote = acquisitionQuote(game, "ridge-electric");
  expect(quote).toBeDefined();
  expect(
    transferUtility(game, {
      targetId: "ridge-electric",
      financed: false,
      quoteKey: quote!.quoteKey,
    }),
  ).toBe(true);
  const wind = GENERATORS(game, 50e6, [20], [500]).find(
    (facility) => facility.fuel === "Wind",
  )!;
  expect(
    territoryBuildAvailability(game, wind, "ridge-electric").buildable,
  ).toBe(true);
  expect(game.transmission!.lines).toEqual([]);
});
