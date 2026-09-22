import cloneDeep from "lodash.clonedeep";
import { LOCATIONS } from "../Constants";
import {
  bestFitHydroSite,
  getHydroAvailability,
  resolveStartingHydroSites,
  validHydroClaims,
  HYDRO_SITES,
} from "./HydroSites";
import { createGame } from "../testing/Simulator";
import { GENERATORS } from "./Facilities";
import gameReducer, {
  buildFacility,
  sellFacility,
  generateNewTimeline,
  tickState,
} from "../reducers/Game";
import { GameType } from "../Types";
const MW = 1000000;
const sites = [10, 25, 80].map((n) => ({
  id: String(n),
  name: String(n),
  maxPeakW: n * MW,
  lat: 0,
  lon: 0,
}));
function state(): GameType {
  const s = createGame({ scenarioId: 103 });
  s.location = { ...LOCATIONS.PIT };
  s.facilities = [];
  s.commissionedHydroSiteIds = [];
  s.timeline.forEach((t) => (t.cash = 1e12));
  return s;
}
function quote(s: GameType, watts: number, yearsToBuild = 1) {
  return {
    ...GENERATORS(s, watts, [], []).find((g) => g.name === "Hydro")!,
    buildCost: 1000,
    yearsToBuild,
  };
}
it("chooses smallest fitting site, exact fit, lexical ties, no pooling and rejects invalid watts", () => {
  expect(bestFitHydroSite(sites, 20 * MW)?.id).toBe("25");
  expect(bestFitHydroSite(sites, 80 * MW)?.id).toBe("80");
  expect(bestFitHydroSite(sites, 100 * MW)).toBeUndefined();
  expect(
    bestFitHydroSite(
      [...sites, { ...sites[1], id: "a" }, { ...sites[1], id: "0" }],
      20 * MW,
    )?.id,
  ).toBe("0");
  [0, -1, NaN, Infinity, 1.5].forEach((w) =>
    expect(bestFitHydroSite(sites, w)).toBeUndefined(),
  );
  expect(bestFitHydroSite([], MW)).toBeUndefined();
});
it("distinguishes permission, missing research, custom coordinates and exhausted inventory", () => {
  const s = state();
  expect(getHydroAvailability(s, MW).status).toBe("available");
  s.location.resources = { hydro: false };
  expect(getHydroAvailability(s, MW).status).toBe("prohibited");
  s.location = { ...LOCATIONS.PIT, lat: 0, resources: { hydro: true } };
  expect(getHydroAvailability(s, MW).status).toBe("unavailable");
  s.location = { ...LOCATIONS.PIT };
  s.commissionedHydroSiteIds = getHydroAvailability(s, MW).remaining.map(
    (v) => v.id,
  );
  expect(getHydroAvailability(s, MW).status).toBe("exhausted");
});
it("reserves explicit starts first and preserves authored fleet order and exact capacity", () => {
  const s = state();
  const available = getHydroAvailability(s, MW).remaining;
  const large = available[available.length - 1];
  const fleet = [
    { name: "Hydro", peakW: MW },
    { name: "Hydro", peakW: large.maxPeakW, hydroSiteId: large.id },
  ];
  const assigned = resolveStartingHydroSites(s.location, fleet);
  expect(assigned[1]).toBe(large.id);
  expect(assigned[0]).not.toBe(large.id);
  expect(() =>
    resolveStartingHydroSites(s.location, [fleet[1], fleet[1]]),
  ).toThrow("no fitting site");
  expect(() =>
    resolveStartingHydroSites(s.location, [
      { name: "Hydro", peakW: large.maxPeakW + 1 },
    ]),
  ).toThrow();
  s.location.resources = { hydro: false };
  expect(resolveStartingHydroSites(s.location, [fleet[1]])).toEqual([large.id]);
});
it("rejects forged identities and capacity before any side effects; stale quotes allocate authoritatively", () => {
  const s = state();
  const largest = getHydroAvailability(s, MW).largest!;
  const q = quote(s, largest.maxPeakW);
  const first = gameReducer(
    s,
    buildFacility({
      facility: { ...q, hydroSiteId: "forged" },
      financed: false,
    }),
  );
  expect(first.facilities[0].hydroSiteId).toBe(largest.id);
  expect(first.facilities[0].peakW).toBe(largest.maxPeakW);
  expect(
    gameReducer(first, buildFacility({ facility: q, financed: false })),
  ).toEqual(first);
  for (const facility of [
    { ...q, peakW: largest.maxPeakW + 1, maxPeakW: 1e15 },
    { ...q, name: "Wind" },
    { ...q, fuel: "Wind" as const },
    { ...q, peakWh: 1, maxPeakWh: 1, roundTripEfficiency: 1, hourlyLoss: 0 },
  ])
    expect(
      gameReducer(s, buildFacility({ facility, financed: false })),
    ).toEqual(s);
});
it("releases cancellations but commissioning and sale preserve claims; projections own claims", () => {
  const s = state();
  const largest = getHydroAvailability(s, MW).largest!;
  const built = gameReducer(
    s,
    buildFacility({ facility: quote(s, largest.maxPeakW), financed: false }),
  );
  let copy = cloneDeep(built);
  copy.facilities[0].yearsToBuildLeft = 0.00000001;
  generateNewTimeline(copy, 1e12, 100);
  expect(copy.commissionedHydroSiteIds).toEqual([]);
  const cancelled = gameReducer(copy, sellFacility(copy.facilities[0].id));
  expect(getHydroAvailability(cancelled, largest.maxPeakW).selected?.id).toBe(
    largest.id,
  );
  copy = cloneDeep(copy);
  tickState(copy);
  expect(copy.commissionedHydroSiteIds).toContain(largest.id);
  expect(validHydroClaims(copy)).toBe(true);
  const sold = gameReducer(copy, sellFacility(copy.facilities[0].id));
  expect(sold.commissionedHydroSiteIds).toContain(largest.id);
  expect(getHydroAvailability(sold, largest.maxPeakW).status).toBe("too-large");
  expect(validHydroClaims(sold)).toBe(true);
  const immediate = gameReducer(
    s,
    buildFacility({ facility: quote(s, largest.maxPeakW, 0), financed: false }),
  );
  expect(immediate.commissionedHydroSiteIds).toEqual([largest.id]);
});
it("validates historical claims, labeled facilities, reservation collisions and prohibition separately", () => {
  const s = state();
  const site = getHydroAvailability(s, MW).selected!;
  const built = cloneDeep(
    gameReducer(
      s,
      buildFacility({ facility: quote(s, site.maxPeakW, 0), financed: false }),
    ),
  );
  built.facilities[0].name = "My dam";
  built.location.resources = { hydro: false };
  expect(validHydroClaims(built)).toBe(true);
  built.commissionedHydroSiteIds.push(site.id);
  expect(validHydroClaims(built)).toBe(false);
  built.commissionedHydroSiteIds = [site.id];
  built.facilities[0].yearsToBuildLeft = 1;
  expect(validHydroClaims(built)).toBe(false);
  built.commissionedHydroSiteIds = [];
  expect(validHydroClaims(built)).toBe(true);
  built.facilities[0].peakW = HYDRO_SITES[site.id].maxPeakW + 1;
  expect(validHydroClaims(built)).toBe(false);
});

it("resolves an unloaded catalogue city only at its canonical coordinates", () => {
  const game = state();
  game.location = { id: "Madrid", name: "Madrid", lat: 40.4168, long: -3.7038 };
  expect(LOCATIONS.Madrid).toBeUndefined();
  expect(getHydroAvailability(game, 1000000).status).toBe("available");
  game.location.long += 1;
  expect(getHydroAvailability(game, 1000000).status).toBe("unavailable");
});
