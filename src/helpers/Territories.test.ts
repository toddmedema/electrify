import type {
  FacilityOperatingType,
  FacilityShoppingType,
  GameType,
} from "../Types";
import { GENERATORS, STORAGE } from "../data/Facilities";
import {
  GREEN_UPLANDS_CORRIDOR_ID,
  isTerritoryId,
  TERRITORIES,
} from "../data/Territories";
import { inheritedConnection } from "./PowerAgreements";
import { createGame } from "../testing/Simulator";
import { currentTick } from "./GameSelectors";
import {
  facilityTerritoryId,
  hasTerritoryNetwork,
  internalTerritoryEdges,
  isInternalTerritoryCorridor,
  ownedTerritories,
  territoryBuildAvailability,
  territoryDemandShares,
  territoryForCorridor,
} from "./Territories";

function network(): GameType {
  const game = createGame({ scenarioId: 116, seed: 188 });
  game.territoryNetwork = { version: 1 };
  return game;
}
function connection(game: GameType, corridorId: string) {
  const line = {
    ...inheritedConnection("champlain", 99),
    corridorId,
    capacityW: 120e6,
  };
  game.transmission!.lines.push(line);
  return line;
}
function ownedValley(game: GameType) {
  game.utilityExpansion!.acquisitions.push({
    targetId: "valley-electric",
    minute: 0,
    financed: false,
    transferredCustomers: 159000,
  });
  return connection(game, "vt-champlain-valley");
}
function generator(
  fuel: "Wind" | "Sun" | "Natural Gas" | "Hydro",
  peakW = 100e6,
): FacilityShoppingType {
  return {
    ...GENERATORS(network(), peakW, [], []).find(
      (facility) => facility.fuel === fuel,
    )!,
    peakW,
  };
}

it("scopes the network to marked scenario116, accepts only catalogue IDs and resolves inherited provenance", () => {
  const game = network();
  expect(hasTerritoryNetwork(game)).toBe(true);
  expect(hasTerritoryNetwork({ ...game, scenarioId: 100 })).toBe(false);
  expect(hasTerritoryNetwork({ ...game, territoryNetwork: undefined })).toBe(
    false,
  );
  expect(isTerritoryId("green-uplands")).toBe(true);
  expect(isTerritoryId("constructor")).toBe(false);
  expect(
    facilityTerritoryId({ startingAssetId: "scenario-116-valley-oil" }),
  ).toBe("valley-electric");
  expect(
    facilityTerritoryId({ startingAssetId: "scenario-116-ridge-wind" }),
  ).toBe("ridge-electric");
  expect(facilityTerritoryId({})).toBe("champlain");
  expect(
    facilityTerritoryId({
      startingAssetId: "scenario-116-valley-oil",
      territoryId: "champlain",
    }),
  ).toBe("champlain");
});

it("retains greenfield ownership while paused but rejects remote builds until an owned link is complete and enabled", () => {
  const game = network();
  expect(ownedTerritories(game)).toEqual(["champlain"]);
  expect(
    territoryBuildAvailability(game, generator("Wind"), "valley-electric")
      .buildable,
  ).toBe(false);
  const valley = ownedValley(game);
  expect(
    territoryBuildAvailability(game, generator("Wind"), "valley-electric")
      .buildable,
  ).toBe(true);
  valley.paused = true;
  expect(ownedTerritories(game)).toContain("valley-electric");
  expect(
    territoryBuildAvailability(game, generator("Wind"), "valley-electric")
      .buildable,
  ).toBe(false);
  const uplands = connection(game, GREEN_UPLANDS_CORRIDOR_ID);
  uplands.yearsToBuildLeft = 1;
  expect(ownedTerritories(game)).not.toContain("green-uplands");
  uplands.yearsToBuildLeft = 0;
  expect(
    territoryBuildAvailability(game, generator("Wind"), "green-uplands")
      .buildable,
  ).toBe(true);
  uplands.paused = true;
  expect(ownedTerritories(game)).toContain("green-uplands");
  expect(
    territoryBuildAvailability(game, generator("Wind"), "green-uplands")
      .buildable,
  ).toBe(false);
});

it("reserves finite typed sites during construction and caps storage power rather than duration", () => {
  const game = network();
  const wind = generator("Wind", 150e6);
  expect(
    territoryBuildAvailability(game, { ...wind, peakW: 150e6 + 1 }, "champlain")
      .buildable,
  ).toBe(false);
  expect(territoryBuildAvailability(game, wind, "champlain").buildable).toBe(
    true,
  );
  const windBudget = TERRITORIES[0].sites.wind.count;
  game.facilities = Array.from(
    { length: windBudget },
    (_, id) =>
      ({
        ...wind,
        id,
        territoryId: "champlain",
        yearsToBuildLeft: 1,
      }) as FacilityOperatingType,
  );
  expect(territoryBuildAvailability(game, wind, "champlain")).toMatchObject({
    buildable: false,
    remaining: 0,
  });
  game.facilities.pop();
  expect(territoryBuildAvailability(game, wind, "champlain").buildable).toBe(
    true,
  );
  const storage = { ...STORAGE(game, 150e12)[0], peakW: 150e6, peakWh: 150e12 };
  expect(territoryBuildAvailability(game, storage, "champlain").buildable).toBe(
    true,
  );
  expect(
    territoryBuildAvailability(game, { ...storage, peakW: 151e6 }, "champlain")
      .buildable,
  ).toBe(false);
  connection(game, GREEN_UPLANDS_CORRIDOR_ID);
  expect(
    territoryBuildAvailability(game, generator("Natural Gas"), "green-uplands")
      .buildable,
  ).toBe(false);
  expect(
    territoryBuildAvailability(game, generator("Hydro"), "champlain").buildable,
  ).toBe(false);
});

it("apportions actual sector load with stable sums, no unowned customers and no greenfield customers", () => {
  const game = network();
  const tick = {
    ...currentTick(game)!,
    demandW: 300e6,
    demandByType: {
      Residential: 300e6,
      Commercial: 0,
      Industrial: 0,
      Transportation: 0,
      "Data Centers": 0,
      Mining: 0,
    },
  };
  expect(territoryDemandShares(game, tick)).toEqual({
    champlain: 300e6,
    "valley-electric": 0,
    "ridge-electric": 0,
    "green-uplands": 0,
  });
  ownedValley(game);
  connection(game, GREEN_UPLANDS_CORRIDOR_ID);
  const residential = territoryDemandShares(game, tick);
  const industrial = territoryDemandShares(game, {
    ...tick,
    demandByType: { ...tick.demandByType, Residential: 0, Industrial: 300e6 },
  });
  expect(Object.values(residential).reduce((sum, w) => sum + w, 0)).toBe(
    tick.demandW,
  );
  expect(residential["valley-electric"]).toBeGreaterThan(0);
  expect(residential["green-uplands"]).toBe(0);
  expect(residential["ridge-electric"]).toBe(0);
  expect(industrial["valley-electric"]).not.toBe(
    residential["valley-electric"],
  );
});

it("keeps internal flow capacity separate from external interfaces and honors weather, construction, pauses and incidents", () => {
  const game = network();
  const line = ownedValley(game);
  const tick = { temperatureC: 20, solarIrradianceWM2: 0 };
  expect(territoryForCorridor("vt-valley-regional")).toBe("valley-electric");
  expect(territoryForCorridor("newengland-quebec-upgrade")).toBe("champlain");
  expect(isInternalTerritoryCorridor(game, "vt-valley-regional")).toBe(false);
  expect(isInternalTerritoryCorridor(game, GREEN_UPLANDS_CORRIDOR_ID)).toBe(
    true,
  );
  expect(internalTerritoryEdges(game, tick)).toEqual([
    {
      id: line.id,
      corridorId: line.corridorId,
      from: "champlain",
      to: "valley-electric",
      capacityW: 120e6,
    },
  ]);
  expect(
    internalTerritoryEdges(game, { ...tick, temperatureC: 40 })[0].capacityW,
  ).toBeLessThan(120e6);
  expect(
    internalTerritoryEdges(game, {
      ...tick,
      transmissionCapacityLimitsWByCorridor: { [line.corridorId]: 20e6 },
    })[0].capacityW,
  ).toBe(20e6);
  line.yearsToBuildLeft = 1;
  expect(internalTerritoryEdges(game, tick)[0].capacityW).toBe(0);
  line.yearsToBuildLeft = 0;
  line.paused = true;
  expect(internalTerritoryEdges(game, tick)[0].capacityW).toBe(0);
});
