import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import { DEMAND_TYPES, demandByTypeAt } from "../data/DemandProfiles";
import { areaBaselineDemand } from "./AreaDemand";
import { cityProfile } from "./CityProfiles";
import { customerMarketSizeAt } from "./Customers";
import { getDateFromMinute } from "./DateTime";
import { acquisitionQuote, transferUtility } from "./Expansion";
import { territoryDemandByType, territoryDemandShares } from "./Territories";
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
  for (const id of ["parcel-1", "parcel-5"] as const) {
    const demand = cityDemandByType(game, tick, id, false);
    expect(demand.Residential).toBeGreaterThan(0);
    expect(demand.Commercial).toBeGreaterThan(0);
    expect(demand.Industrial).toBeGreaterThan(0);
  }
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

it.each(["parcel-1", "parcel-5", "valley-electric"] as const)(
  "uses the central mixed profile to render public demand for %s",
  (id) => {
    const game = createGame({ scenarioId: 116, seed: 188 });
    const tick = currentTick(game)!;
    const profile = cityProfile(game.seed, id)!;
    const date = getDateFromMinute(tick.minute, game.startingYear);
    const { baselineW } = areaBaselineDemand(
      date,
      game.location,
      tick.temperatureC,
      customerMarketSizeAt(profile.customers, tick.minute),
      profile.demandScale,
      profile.demandShapeExponent,
    );
    expect(cityDemandByType(game, tick, id, false)).toEqual(
      demandByTypeAt(
        baselineW,
        date,
        game.startingYear,
        game.location,
        [],
        profile.energyShares,
      ),
    );
  },
);
it("allocates every actual company end use exactly once among the owned mixed cities", () => {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 2e9;
  for (const targetId of ["valley-electric", "ridge-electric"] as const) {
    const quote = acquisitionQuote(game, targetId)!;
    expect(
      transferUtility(game, {
        targetId,
        financed: false,
        quoteKey: quote.quoteKey,
      }),
    ).toBe(true);
  }
  const tick = currentTick(game)!;
  const ids = ["champlain", "valley-electric", "ridge-electric"] as const;
  const allocation = ids.map((id) => cityDemandByType(game, tick, id, true));
  for (const sector of DEMAND_TYPES) {
    expect(allocation.reduce((sum, area) => sum + area[sector], 0)).toBeCloseTo(
      tick.demandByType[sector],
      6,
    );
  }
  const shares = territoryDemandShares(game, tick);
  for (const id of ids) {
    expect(
      Object.values(cityDemandByType(game, tick, id, true)).reduce(
        (sum, watts) => sum + watts,
        0,
      ),
    ).toBeCloseTo(shares[id], 6);
  }
});
