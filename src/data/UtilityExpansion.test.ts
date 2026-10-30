import fs from "fs";
import path from "path";
import {
  DAYS_PER_YEAR,
  GAME_TO_REAL_YEARS,
  TICK_MINUTES,
  LOCATIONS,
} from "../Constants";
import { areaBaselineDemand } from "../helpers/AreaDemand";
import { getDateFromMinute } from "../helpers/DateTime";
import { weatherLocationIds } from "../helpers/WeatherLocations";
import { loadSimData } from "../testing/SimData";
import { climateLoadArchetype, demandByTypeAt } from "./DemandProfiles";
import { corridorsForLocation } from "./AdjacentMarkets";
import { getHydroAvailability, resolveStartingHydroSites } from "./HydroSites";
import { getViableLocationCount } from "./FacilitySites";
import { importEmissionsKgco2ePerMWh } from "./ImportEmissions";
import { getWeather, hasWeather, initWeather } from "./Weather";
import { SCENARIOS } from "./Scenarios";
import {
  UTILITY_AREAS,
  UTILITY_TARGETS,
  utilityEntitlementsAt,
} from "./UtilityExpansion";

/** Fixed accounts and neutral prices: fit shape to peak/mean first, then annual energy. */
function calibratedYear(area: typeof UTILITY_AREAS.champlain) {
  loadSimData(area.location);
  const loads = Array.from(
    { length: (DAYS_PER_YEAR * 1440) / TICK_MINUTES },
    (_, index) => {
      const date = getDateFromMinute(index * TICK_MINUTES, 2005);
      const weather = getWeather(date, 12345, 0, area.location.id);
      const baseline = areaBaselineDemand(
        date,
        area.location,
        weather.TEMP_C,
        area.customers,
        area.demandScale,
        area.demandShapeExponent,
      ).baselineW;
      // Freeze structural growth while fitting the first-year seasonal/daily shape.
      return demandByTypeAt(
        baseline,
        { ...date, minute: 0 },
        2005,
        area.location,
        [],
        area.energyShares,
      );
    },
  );
  const totals = loads.map((load) =>
    Object.values(load).reduce((sum, value) => sum + value, 0),
  );
  return {
    annualEnergyMWh:
      (((totals.reduce((sum, value) => sum + value, 0) * TICK_MINUTES) / 60) *
        GAME_TO_REAL_YEARS) /
      1e6,
    peakDemandW: Math.max(...totals),
  };
}

describe("Across the Valley catalog", () => {
  it.each(Object.values(UTILITY_AREAS))(
    "fits $name to its separately sampled 2005 weather",
    (area) => {
      const fitted = calibratedYear(area);
      expect(fitted.annualEnergyMWh).toBeGreaterThanOrEqual(
        area.annualEnergyMWh * 0.95,
      );
      expect(fitted.annualEnergyMWh).toBeLessThanOrEqual(
        area.annualEnergyMWh * 1.05,
      );
      expect(fitted.peakDemandW).toBeGreaterThanOrEqual(area.peakDemandW * 0.9);
      expect(fitted.peakDemandW).toBeLessThanOrEqual(area.peakDemandW * 1.1);
      expect(climateLoadArchetype(area.location)).toBe("fuel-heating");
      expect(area.addressablePool).toBe(area.customers * 2);
      expect(getViableLocationCount(area.location, "Pumped Hydro")).toBe(0);
      expect(
        getHydroAvailability(
          {
            location: area.location,
            scenarioId: 116,
            facilities: [],
            commissionedHydroSiteIds: [],
          },
          1e6,
        ).status,
      ).toBe("prohibited");
      expect(
        resolveStartingHydroSites(area.location, area.facilities).filter(
          Boolean,
        ),
      ).toHaveLength(area.id === "ridge-electric" ? 0 : 1);
    },
  );

  it("loads each local weather series before any acquisition and preserves distinct observations", () => {
    loadSimData(UTILITY_AREAS.champlain.location);
    expect(hasWeather(UTILITY_AREAS.champlain.location)).toBe(true);
    expect(weatherLocationIds(UTILITY_AREAS.champlain.location)).toEqual([
      "BurlingtonVT",
      "RutlandVT",
      "WhiteRiverJunctionVT",
    ]);
    const temperatures = Object.values(UTILITY_AREAS).map((area) =>
      Array.from(
        { length: 12 },
        (_, month) =>
          getWeather(
            getDateFromMinute(month * 1440 + 720, 2005),
            12345,
            0,
            area.location.id,
          ).TEMP_C,
      ),
    );
    expect(temperatures[0]).not.toEqual(temperatures[1]);
    expect(temperatures[1]).not.toEqual(temperatures[2]);
  });

  it("dates Valley's reduction without mutating or restarting its entitlement", () => {
    const original = UTILITY_AREAS["valley-electric"].entitlements[0];
    expect(utilityEntitlementsAt("valley-electric", 2016)[0].nominalW).toBe(
      160e6,
    );
    expect(utilityEntitlementsAt("valley-electric", 2017)[0].nominalW).toBe(
      80e6,
    );
    expect(utilityEntitlementsAt("valley-electric", 2024)[0].nominalW).toBe(
      80e6,
    );
    expect(original.nominalW).toBe(160e6);
    expect(utilityEntitlementsAt("ridge-electric", 2017)[0].nominalW).toBe(
      40e6,
    );
    expect(utilityEntitlementsAt("champlain", 2025)).toEqual([]);
    expect(importEmissionsKgco2ePerMWh("vt-valley-pool", 2005)).toBe(417);
    expect(importEmissionsKgco2ePerMWh("vt-ridge-pool", 2010)).toBe(376);
    expect(importEmissionsKgco2ePerMWh("vt-valley-pool", 2024)).toBe(354);
  });

  it("uses utility-scale authored lines and fresh seeds without a reliability override", () => {
    const scenario = SCENARIOS.find(({ id }) => id === 116)!;
    expect(scenario.seed).toBeUndefined();
    expect(scenario).not.toHaveProperty("reliabilityObjective");
    expect(scenario.durationMonths).toBe(240);
    expect(scenario.ownership).toBe("Investor");
    const corridors = corridorsForLocation(UTILITY_AREAS.champlain.location);
    expect(corridors.map(({ id }) => id)).toEqual(
      UTILITY_TARGETS.map(({ corridorId }) => corridorId),
    );
    corridors.forEach((corridor) => {
      expect(corridor.capacityW).toBe(100e6);
      expect(corridor.routeType).toBe("EXISTING");
    });
    const assets = Object.values(UTILITY_AREAS).flatMap(({ facilities }) =>
      facilities.map(({ assetId }) => assetId),
    );
    expect(new Set(assets).size).toBe(assets.length);
    expect(assets.every((id) => id?.startsWith("scenario-116-"))).toBe(true);
  });
});

it("browser and worker weather initialization awaits every owned-area record", async () => {
  const originalFetch = global.fetch;
  const fetchWeather = jest.fn((input: RequestInfo | URL) => {
    const id = String(input).split("/").at(-1)!;
    const bytes = fs.readFileSync(
      path.join(process.cwd(), "public/data/weather", id),
    );
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(buffer),
    } as Response);
  });
  global.fetch = fetchWeather;
  try {
    await new Promise<void>((resolve, reject) =>
      initWeather(UTILITY_AREAS.champlain.location, (failure) =>
        failure ? reject(new Error(failure)) : resolve(),
      ),
    );
    expect(fetchWeather.mock.calls.map(([url]) => url)).toEqual([
      "/data/weather/BurlingtonVT.bin",
      "/data/weather/RutlandVT.bin",
      "/data/weather/WhiteRiverJunctionVT.bin",
    ]);
    expect(hasWeather(UTILITY_AREAS.champlain.location)).toBe(true);
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 404 } as Response),
    );
    const failure = await new Promise<string | undefined>((resolve) =>
      initWeather(UTILITY_AREAS.champlain.location, resolve),
    );
    expect(failure).toMatch(/Could not load the weather/);
    expect(hasWeather(UTILITY_AREAS.champlain.location)).toBe(false);
  } finally {
    global.fetch = originalFetch;
  }
});

it("inherited fictional hydro claims cannot become greenfield sites in custom games", () => {
  for (const id of ["champlain", "valley-electric"] as const) {
    const definition = UTILITY_AREAS[id];
    const downloadedLocation = { ...definition.location, resources: undefined };
    expect(
      getHydroAvailability(
        {
          location: downloadedLocation,
          scenarioId: 999,
          facilities: [],
          commissionedHydroSiteIds: [],
        },
        10e6,
      ).status,
    ).toBe("prohibited");
    expect(
      resolveStartingHydroSites(
        downloadedLocation,
        definition.facilities,
      ).filter(Boolean),
    ).toHaveLength(1);
  }
  expect(
    getHydroAvailability(
      {
        location: LOCATIONS.PIT,
        scenarioId: 999,
        facilities: [],
        commissionedHydroSiteIds: [],
      },
      10e6,
    ).status,
  ).toBe("available");
});
