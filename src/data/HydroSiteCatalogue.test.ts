import { readFileSync } from "fs";
import { join } from "path";
import catalogue from "./HydroSiteCatalogue.json";
import { SCENARIOS } from "./Scenarios";
import { LOCATIONS } from "../Constants";
import {
  HYDRO_INVENTORIES,
  HYDRO_SITES,
  resolveStartingHydroSites,
} from "./HydroSites";

const distanceKm = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((a.lat - b.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((a.lon - b.lon) * rad) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};

describe("researched conventional Hydro catalogue", () => {
  it("has an explicit research disposition for every authored and shipped city", () => {
    const cities = JSON.parse(
      readFileSync(join(process.cwd(), "scripts/cities.json"), "utf8"),
    ) as { cities: { id: string; lat: number; long: number }[] };
    const shipped = JSON.parse(
      readFileSync(
        join(process.cwd(), "public/data/weather/index.json"),
        "utf8",
      ),
    ) as { cities: Record<string, unknown> };
    for (const id of [
      ...cities.cities.map((city) => city.id),
      ...Object.keys(shipped.cities),
    ]) {
      const inventory = HYDRO_INVENTORIES[id];
      expect(inventory).toBeDefined();
      expect(["researched", "unresearched"]).toContain(inventory.status);
      expect(inventory.researchDisposition.length).toBeGreaterThan(50);
      expect(
        inventory.status !== "unresearched" || inventory.siteIds.length === 0,
      ).toBe(true);
    }
    for (const city of cities.cities)
      for (const id of HYDRO_INVENTORIES[city.id].siteIds) {
        expect(
          distanceKm({ lat: city.lat, lon: city.long }, HYDRO_SITES[id]),
        ).toBeLessThanOrEqual(250);
      }
  });

  it("uses unique physical records with integer source watts and provenance", () => {
    expect(new Set(catalogue.sites.map((site) => site.id)).size).toBe(
      catalogue.sites.length,
    );
    for (const site of catalogue.sites) {
      expect(Number.isSafeInteger(site.maxPeakW)).toBe(true);
      expect(site.maxPeakW).toBeGreaterThanOrEqual(1000000);
      expect(site.maxPeakW).toBe(Math.round(site.originalValue * 1000000));
      expect(site.originalUnit).toBe("MW");
      expect(Number.isFinite(site.lat) && Math.abs(site.lat) <= 90).toBe(true);
      expect(Number.isFinite(site.lon) && Math.abs(site.lon) <= 180).toBe(true);
      expect(site.sourceUrl).toMatch(/^https?:\/\//);
      expect(site.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(site.datasetVersion).toBeTruthy();
      expect(site.notes).toBeTruthy();
      expect(site).not.toHaveProperty("commissioningYear");
      expect(site).not.toHaveProperty("developmentCategory");
    }
    for (const inventory of Object.values(HYDRO_INVENTORIES)) {
      expect(new Set(inventory.siteIds).size).toBe(inventory.siteIds.length);
      for (const id of inventory.siteIds) expect(HYDRO_SITES[id]).toBeDefined();
    }
    for (const id of [
      "revin-fra",
      "villarino-4-esp",
      "lam-ta-khong-tha",
      "karlshamn-swe",
      "bolarque-ii-grupo-1-esp",
      "rio-grande-arg",
    ])
      expect(HYDRO_SITES[id]).toBeUndefined();
  });

  it("corroborates Pittsburgh and every authored starting Hydro fleet", () => {
    const pittsburgh = HYDRO_INVENTORIES.PIT;
    expect(pittsburgh.status).toBe("researched");
    expect(pittsburgh.siteIds).toHaveLength(24);
    expect(
      Math.max(...pittsburgh.siteIds.map((id) => HYDRO_SITES[id].maxPeakW)),
    ).toBe(HYDRO_SITES["lake-lynn-hydro-station-us"].maxPeakW);
    for (const scenario of SCENARIOS) {
      const location = scenario.location || LOCATIONS[scenario.locationId];
      const assignments = resolveStartingHydroSites(
        location,
        scenario.facilities || [],
        scenario.hydroInventoryKey,
      );
      scenario.facilities
        ?.map((facility, index) => ({ facility, index }))
        .filter(({ facility }) => facility.fuel === "Hydro" && !facility.peakWh)
        .forEach(({ facility, index }) => {
          expect(assignments[index]).toBe(facility.hydroSiteId);
        });
    }
    for (const scenario of SCENARIOS.filter((s) => s.hydroInventoryKey)) {
      const inventory = HYDRO_INVENTORIES[scenario.hydroInventoryKey!];
      expect(inventory.authoredScenarioId).toBe(scenario.id);
      expect(inventory.locationId).toBe(
        (scenario.location || LOCATIONS[scenario.locationId]).id,
      );
      expect(inventory.status).toBe("researched");
    }
    for (const [key, inventory] of Object.entries(HYDRO_INVENTORIES).filter(
      ([, inventory]) => inventory.authoredScenarioId !== undefined,
    )) {
      expect(
        SCENARIOS.find((s) => s.id === inventory.authoredScenarioId)
          ?.hydroInventoryKey,
      ).toBe(key);
    }
    const zambia = SCENARIOS.find((s) => s.id === 114)!;
    expect(
      zambia.facilities
        .filter((f) => f.fuel === "Hydro")
        .reduce((sum, f) => sum + (f.peakW || 0), 0),
    ).toBe(435000000);
    expect(HYDRO_INVENTORIES.Lusaka.siteIds).not.toContain(
      "victoria-falls-zmb",
    );
    expect(HYDRO_INVENTORIES["scenario:114"].siteIds).toContain(
      "victoria-falls-zmb",
    );
  });
});
