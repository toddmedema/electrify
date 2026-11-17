import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { territoryDemandByType } from "./Territories";
import { cityDemandByType } from "./CityDemand";

it("retains actual sector allocation for owned cities", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const tick = currentTick(game)!;
  expect(cityDemandByType(game, tick, "champlain", true)).toEqual(
    territoryDemandByType(game, tick, "champlain"),
  );
});

it("shows unowned utilities and neutral cities without changing company demand or finances", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const before = JSON.stringify(game);
  const tick = currentTick(game)!;
  for (const id of [
    "valley-electric",
    "ridge-electric",
    "parcel-1",
    "parcel-5",
  ] as const) {
    const profile = cityDemandByType(game, tick, id, false);
    expect(
      Object.values(profile).every(
        (watts) => Number.isFinite(watts) && watts >= 0,
      ),
    ).toBe(true);
    expect(
      Object.values(profile).reduce((sum, watts) => sum + watts, 0),
    ).toBeGreaterThan(0);
  }
  expect(cityDemandByType(game, tick, "parcel-1", false).Industrial).toBe(0);
  expect(cityDemandByType(game, tick, "parcel-5", false).Residential).toBe(0);
  expect(JSON.stringify(game)).toBe(before);
});

it("uses the regional daily demand model for a neighbouring city", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const totals = game.timeline.map((tick) =>
    Object.values(
      cityDemandByType(game, tick, "valley-electric", false),
    ).reduce((sum, watts) => sum + watts, 0),
  );
  expect(Math.max(...totals)).toBeGreaterThan(Math.min(...totals));
});
