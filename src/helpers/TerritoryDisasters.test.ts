import { VALLEY_BOARD } from "../data/TerritoryTiles";
import { createGame } from "../testing/Simulator";
import type { GameType } from "../Types";
import { getDateFromMinute } from "./DateTime";
import { COLD_DEFINITION_ID, HAIL_DEFINITION_ID } from "./Hazards";
import { readTerritoryDisasters } from "./TerritoryDisasters";
import { getFacilityTile } from "./TerritoryTiles";

it("shows hail impacts only on damaged tiles and distinguishes strikes, repair works and frost", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const [hailed, frozen] = game.facilities;
  const hailSite = getFacilityTile(hailed, game)!;
  const coldSite = getFacilityTile(frozen, game)!;
  const forest = VALLEY_BOARD.find(({ terrain }) => terrain === "forest")!;
  const state: GameType = {
    ...game,
    territoryWeather: { dryness: 0.78, fires: [] },
    worldEvents: {
      ...game.worldEvents,
      active: [
        {
          key: "hail",
          definitionId: HAIL_DEFINITION_ID,
          startsMinute: 0,
          endsMinute: 180,
          effects: { facilityOutputMultipliersById: { [hailed.id]: 0.75 } },
          attributes: { hazard: "HAIL", facilityId: hailed.id },
        },
        {
          key: "cold",
          definitionId: COLD_DEFINITION_ID,
          startsMinute: 0,
          endsMinute: 120,
          effects: { facilityOutputMultipliersById: { [frozen.id]: 0.7 } },
          attributes: { hazard: "EXTREME_COLD", regional: true },
        },
      ],
    },
  };

  let condition = readTerritoryDisasters(state);
  expect(condition(hailSite, hailed)).toMatchObject({
    hail: "impact",
    condition: expect.stringContaining("Hail strike"),
  });
  expect(condition(coldSite, frozen)).toMatchObject({
    frost: "derate",
    facilityImpact: expect.stringContaining("70% available"),
  });
  expect(condition(forest)).toMatchObject({
    ground: "parched",
    frost: "regional",
  });
  expect(condition(forest)?.hail).toBeUndefined();

  const cold = state.worldEvents.active[1];
  const overlap = readTerritoryDisasters({
    ...state,
    worldEvents: {
      ...state.worldEvents,
      active: [
        ...state.worldEvents.active,
        {
          ...cold,
          effects: { facilityOutputMultipliersById: { [hailed.id]: 0.8 } },
        },
      ],
    },
  });
  expect(overlap(hailSite, hailed)).toMatchObject({
    condition: "Hail strike · Extreme cold",
    facilityImpact:
      "Combined weather impact · 60% available · 4 days to repair",
  });

  state.date = getDateFromMinute(90, game.startingYear);
  condition = readTerritoryDisasters(state);
  expect(condition(hailSite, hailed)).toMatchObject({
    hail: "damage",
    condition: expect.stringContaining("Hail repairs in progress"),
  });
  state.date = getDateFromMinute(180, game.startingYear);
  expect(readTerritoryDisasters(state)(hailSite, hailed)).toBeUndefined();
});
