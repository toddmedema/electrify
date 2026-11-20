import cloneDeep from "lodash.clonedeep";
import { GENERATORS, STORAGE } from "../data/Facilities";
import {
  LAND_TERRITORIES,
  territoryHydroSiteId,
  getTerritoryDefinition,
} from "../data/Territories";
import { createGame } from "../testing/Simulator";
import { customerMarketSizeAt } from "./Customers";
import { currentTick } from "./GameSelectors";
import {
  landPurchaseQuote,
  purchaseLand,
  ownedTerritories,
  territoryBuildAvailability,
  territorySiteInventory,
  tilePurchaseQuotes,
  landPrice,
  landTransferredCustomers,
  territoryDemandByType,
} from "./Territories";
import { cityProfile } from "./CityProfiles";
import { cityDemandByType } from "./CityDemand";
import { combinedUtilityDemandProfile } from "./CombinedUtilityDemand";
import { acquisitionQuote, expansionRetentionBaseline } from "./Expansion";
import { parseSave, serializeSave } from "../SaveGame";
import { validUtilityExpansion } from "./ExpansionValidation";
import { validHydroClaims, getHydroAvailability } from "../data/HydroSites";
import reducer, {
  buildFacility,
  sellFacility,
  tickState,
} from "../reducers/Game";
import { runMonths } from "../testing/SimulationTestHelpers";
import { landCustomerProfiles, landCustomerMarket } from "./TerritoryCustomers";
import { CUSTOMER_MARKET_MULTIPLIER } from "./Customers";
import { programCustomers } from "./Policies";
import {
  acquireLand,
  acquireTile,
  acquireUtility,
  schedulePolicy,
} from "../reducers/GameActions";
import {
  getTerritoryTile,
  getTerritoryTiles,
  territoryHexDistance,
} from "./TerritoryTiles";
import type { GameType, LandTerritoryId, FacilityShoppingType } from "../Types";
function game() {
  const result = createGame({ scenarioId: 116, seed: 12345 });
  currentTick(result)!.cash = 2e9;
  return result;
}
function buy(state: GameType, id: LandTerritoryId) {
  state = cloneDeep(state);
  const target = getTerritoryTiles(state).find(
    (tile) => tile.territoryId === id,
  )!;
  for (
    let step = 0;
    !landPurchaseQuote(state, id) && !acquisitionQuote(state, id) && step < 20;
    step++
  ) {
    const current = state;
    const nearest = [...tilePurchaseQuotes(current).keys()]
      .map((tileId) => getTerritoryTile(tileId, current)!)
      .sort(
        (a, b) =>
          territoryHexDistance(a, target) - territoryHexDistance(b, target),
      )[0];
    const pathQuote = tilePurchaseQuotes(state).get(nearest.id)!;
    state = cloneDeep(
      reducer(
        state,
        acquireTile({
          tileId: pathQuote.tileId,
          quoteKey: pathQuote.quoteKey,
        }),
      ),
    );
  }
  const acquisition = acquisitionQuote(state, id);
  if (acquisition)
    return reducer(
      state,
      acquireUtility({
        targetId: acquisition.targetId,
        financed: false,
        quoteKey: acquisition.quoteKey,
      }),
    );
  const offer = landPurchaseQuote(state, id)!;
  expect(offer).toBeDefined();
  return reducer(
    state,
    acquireLand({ territoryId: id, quoteKey: offer.quoteKey }),
  );
}

function quote(
  state: GameType,
  name: string,
  id: LandTerritoryId,
  peakW = 20e6,
) {
  return GENERATORS(
    state,
    peakW,
    state.timeline.map((t) => t.windKph),
    state.timeline.map((t) => t.solarIrradianceWM2),
    [],
    [],
    id,
  ).find((f) => f.name === name)!;
}
function build(
  state: GameType,
  facility: FacilityShoppingType,
  id: LandTerritoryId,
) {
  return reducer(
    state,
    buildFacility({ facility, financed: false, territoryId: id }),
  );
}
it("quotes visible neutral cells and allows independent purchases without duplicate grants", () => {
  const state = game();
  expect(LAND_TERRITORIES).toHaveLength(19);
  expect(tilePurchaseQuotes(state).size).toBeGreaterThan(0);
  expect(landPurchaseQuote(state, "parcel-17")).toBeUndefined();
  const first = [...tilePurchaseQuotes(state).values()].find((quote) =>
    quote.territoryId.startsWith("frontier:"),
  )!;
  expect(
    purchaseLand(state, {
      territoryId: first.territoryId,
      quoteKey: first.quoteKey,
    }),
  ).toBe(true);
  const cash = currentTick(state)!.cash;
  expect(
    purchaseLand(state, {
      territoryId: first.territoryId,
      quoteKey: first.quoteKey,
    }),
  ).toBe(false);
  expect(currentTick(state)!.cash).toBe(cash);
  const second = [...tilePurchaseQuotes(state).values()].find(
    (quote) =>
      quote.territoryId.startsWith("frontier:") &&
      quote.territoryId !== first.territoryId,
  )!;
  expect(
    purchaseLand(state, {
      territoryId: second.territoryId,
      quoteKey: second.quoteKey,
    }),
  ).toBe(true);
  expect(ownedTerritories(state)).toEqual(
    expect.arrayContaining([
      "champlain",
      first.territoryId,
      second.territoryId,
    ]),
  );
});
it.each(["parcel-1", "parcel-5"] as LandTerritoryId[])(
  "transfers %s mixed city accounts, market and retention benchmark once and round-trips",
  (id) => {
    let state = game();
    const before = currentTick(state)!.customers;
    const originalMarket = state.customerMarketSize;
    const originalBaseline = expansionRetentionBaseline(state);
    const offer = {
      customers: customerMarketSizeAt(
        getTerritoryDefinition(id)!.customers ?? 0,
        state.date.minute,
      ),
    };
    state = buy(state, id);
    expect(currentTick(state)!.customers).toBe(before + offer.customers);
    expect(state.customerMarketSize).toBeGreaterThan(originalMarket);
    expect(expansionRetentionBaseline(state)).toBe(
      originalBaseline + offer.customers,
    );
    const profile = cityProfile(state.seed, id)!;
    const customerProfile = landCustomerProfiles(state).find(
      (area) => area.id === id,
    )!;
    expect(customerProfile).toEqual(profile);
    expect(landTransferredCustomers(state, id)).toBe(offer.customers);
    expect(landCustomerMarket(state)).toBe(
      profile.customers * CUSTOMER_MARKET_MULTIPLIER,
    );
    const combined = combinedUtilityDemandProfile(state);
    for (const sector of ["Residential", "Commercial", "Industrial"] as const) {
      expect(combined.energyShares[sector]).toBeGreaterThan(0);
      expect(customerProfile.energyShares[sector]).toBeGreaterThan(0);
    }
    expect(cityDemandByType(state, currentTick(state)!, id, true)).toEqual(
      territoryDemandByType(state, currentTick(state)!, id),
    );
    expect(validUtilityExpansion(state)).toBe(true);
    const saved = parseSave(JSON.parse(JSON.stringify(serializeSave(state))));
    expect(saved).not.toBeNull();
    expect(saved!.game.customerMarketSize).toBe(state.customerMarketSize);
    const beforeTick = cloneDeep(saved!.game);
    const resumed = cloneDeep(state);
    tickState(beforeTick);
    tickState(resumed);
    expect(JSON.stringify(currentTick(beforeTick))).toBe(
      JSON.stringify(currentTick(resumed)),
    );
  },
);
it("general land shares its two reservations across gas, wind, solar and storage", () => {
  let state = buy(game(), "parcel-2");
  for (const name of ["Natural Gas CC", "Wind", "Solar"])
    expect(
      territoryBuildAvailability(
        state,
        quote(state, name, "parcel-2"),
        "parcel-2",
      ).buildable,
    ).toBe(true);
  const battery = STORAGE(
    { ...state, date: { ...state.date, year: 2025 } },
    50e6,
  ).find((f) => f.name === "Battery")!;
  expect(territoryBuildAvailability(state, battery, "parcel-2").buildable).toBe(
    true,
  );
  expect(
    territoryBuildAvailability(
      state,
      quote(state, "Hydro", "parcel-2"),
      "parcel-2",
    ).buildable,
  ).toBe(false);
  expect(
    territoryBuildAvailability(
      state,
      quote(state, "Geothermal", "parcel-2"),
      "parcel-2",
    ).buildable,
  ).toBe(false);
  state = build(state, quote(state, "Wind", "parcel-2"), "parcel-2");
  state = buy(state, "parcel-2");
  state = build(state, quote(state, "Natural Gas CC", "parcel-2"), "parcel-2");
  expect(territorySiteInventory(state, "parcel-2", "general").remaining).toBe(
    0,
  );
  const ids = state.facilities.map((f) => f.id);
  state = build(state, quote(state, "Solar", "parcel-2"), "parcel-2");
  expect(state.facilities.map((f) => f.id)).toEqual(ids);
  const wind = state.facilities.find(
    (f) => f.territoryId === "parcel-2" && f.fuel === "Wind",
  )!;
  state = reducer(state, sellFacility(wind.id));
  expect(territorySiteInventory(state, "parcel-2", "general").remaining).toBe(
    1,
  );
});
it.each([
  ["parcel-7", "Hydro"],
  ["parcel-3", "Geothermal"],
] as const)(
  "constructs and commissions real bounded %s special sites",
  (id, name) => {
    let state = game();
    expect(quote(state, name, id).available).toBe(false);
    state = buy(state, id);
    const facility = quote(state, name, id);
    expect(facility.available).toBe(true);
    expect(territoryBuildAvailability(state, facility, id).buildable).toBe(
      true,
    );
    expect(
      territoryBuildAvailability(state, { ...facility, peakW: 100e6 }, id)
        .buildable,
    ).toBe(false);
    state = build(state, facility, id);
    const built = state.facilities.find((f) => f.territoryId === id)!;
    expect(built).toBeDefined();
    expect(built.yearsToBuildLeft).toBeGreaterThan(0);
    expect(quote(state, name, id).available).toBe(false);
    expect(built.hydroSiteId).toBe(
      name === "Hydro" ? territoryHydroSiteId(id) : undefined,
    );
    expect(validHydroClaims(state)).toBe(true);
    expect(getHydroAvailability(state, 20e6, id).status).not.toBe("available");
    const next = cloneDeep(state);
    next.facilities.find((f) => f.id === built.id)!.yearsToBuildLeft = 0.000001;
    for (const frame of next.timeline
      .filter((t) => t.minute > next.date.minute)
      .slice(0, 2)) {
      frame.demandW = 1e9;
      for (const key of Object.keys(
        frame.demandByType,
      ) as (keyof typeof frame.demandByType)[])
        frame.demandByType[key] = key === "Residential" ? 1e9 : 0;
    }
    tickState(next);
    tickState(next);
    state = next;
    const operating = state.facilities.find((f) => f.id === built.id)!;
    expect(operating.yearsToBuildLeft).toBe(0);
    expect(operating.lifetimeWh).toBeGreaterThan(0);
    expect(validHydroClaims(state)).toBe(true);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(state)))),
    ).not.toBeNull();
  },
);
it("upgrades schema14 paid land without changing cash, receipts, assets or provenance", () => {
  const state = game();
  state.territoryNetwork!.landPurchases.push({
    territoryId: "green-uplands",
    minute: 0,
    price: landPrice(state, 0),
  });
  const raw = JSON.parse(JSON.stringify(serializeSave(state)));
  raw.schemaVersion = 14;
  raw.game.territoryNetwork.version = 2;
  delete raw.game.territoryNetwork.tilePurchases;
  delete raw.game.territoryNetwork.legacyTiles;
  const restored = parseSave(raw);
  expect(restored).not.toBeNull();
  expect(restored!.game.territoryNetwork!.version).toBe(3);
  expect(restored!.game.territoryNetwork!.landPurchases).toEqual(
    state.territoryNetwork!.landPurchases,
  );
  expect(restored!.game.runIdentity).toEqual(state.runIdentity);
  expect(currentTick(restored!.game)!.cash).toBe(currentTick(state)!.cash);
  const forged = cloneDeep(raw);
  forged.game.territoryNetwork.landPurchases.push({
    territoryId: "parcel-0",
    minute: 0,
    price: 0,
  });
  expect(parseSave(forged)).toBeNull();
});

it("keeps already-paid program coverage, spending, rollout dates and current meters after buying customers", () => {
  let state = game();
  state = reducer(
    state,
    schedulePolicy({ id: "efficiency", tier: "On", month: 1 }),
  );
  const working = cloneDeep(state);
  runMonths(working, 2);
  state = working;
  const prior = cloneDeep(state.policies!.programs.efficiency);
  const eligible = programCustomers(state);
  const meter = currentTick(state)!.efficiencySavedW;
  expect(prior.adoption).toBeGreaterThan(0);
  state = buy(state, "parcel-1");
  const program = state.policies!.programs.efficiency;
  expect(program.adoption * programCustomers(state)).toBeCloseTo(
    prior.adoption * eligible,
    6,
  );
  expect(program.spent).toBe(prior.spent);
  expect(program.spending).toBe(prior.spending);
  expect(program.installs!.map(([date]) => date)).toEqual(
    prior.installs!.map(([date]) => date),
  );
  expect(currentTick(state)!.efficiencySavedW).toBe(meter);
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(state)))),
  ).not.toBeNull();
});

it("rejects new-parcel oversubscription and wrong special-resource claims on save import", () => {
  let state = buy(game(), "parcel-0");
  state = build(state, quote(state, "Wind", "parcel-0"), "parcel-0");
  const raw = JSON.parse(JSON.stringify(serializeSave(state)));
  const plant = raw.game.facilities.find(
    (f: { territoryId?: string }) => f.territoryId === "parcel-0",
  );
  raw.game.facilities.push(
    { ...plant, id: plant.id + 100 },
    { ...plant, id: plant.id + 101 },
  );
  expect(parseSave(raw)).toBeNull();
  const special = buy(game(), "parcel-3");
  const geothermal = build(
    special,
    quote(special, "Geothermal", "parcel-3"),
    "parcel-3",
  );
  const forged = JSON.parse(JSON.stringify(serializeSave(geothermal)));
  forged.game.facilities.find(
    (f: { territoryId?: string }) => f.territoryId === "parcel-3",
  ).peakW = 100e6;
  expect(parseSave(forged)).toBeNull();
});

it.each([null, [null], [{}]])(
  "rejects malformed land receipts %p without throwing",
  (receipts) => {
    const raw = JSON.parse(JSON.stringify(serializeSave(game())));
    raw.game.territoryNetwork.landPurchases = receipts;
    expect(() => parseSave(raw)).not.toThrow();
    expect(parseSave(raw)).toBeNull();
  },
);

it("retains a commissioned hydro site's claim after retirement", () => {
  let state = buy(game(), "parcel-7");
  state = build(state, quote(state, "Hydro", "parcel-7"), "parcel-7");
  const working = cloneDeep(state);
  const plant = working.facilities.find((f) => f.territoryId === "parcel-7")!;
  plant.yearsToBuildLeft = 0.000001;
  tickState(working);
  state = reducer(working, sellFacility(plant.id));
  expect(state.facilities.some((f) => f.id === plant.id)).toBe(false);
  expect(territorySiteInventory(state, "parcel-7", "hydro").remaining).toBe(0);
  expect(quote(state, "Hydro", "parcel-7").available).toBe(false);
  expect(validHydroClaims(state)).toBe(true);
});
