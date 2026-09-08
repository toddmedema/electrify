import cityDocument from "../../scripts/cities.json";
import weatherIndex from "../../public/data/weather/index.json";
import {
  ADJACENT_MARKETS,
  LOCATION_TRANSMISSION_PROFILE_IDS,
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
  adjacentMarketsForLocation,
  corridorsForLocation,
  transmissionAvailable,
} from "./AdjacentMarkets";
import {
  NO_INTERTIE_LOCATION_IDS,
  TRANSMISSION_PROFILE_DATA,
  TRANSMISSION_PROFILE_LOCATION_IDS,
} from "./TransmissionProfiles";

const location = (id: string) => ({ id });

describe("researched transmission profiles", () => {
  it("explicitly covers every current and planned location exactly once", () => {
    const plannedIds = cityDocument.cities.map(({ id }) => id);
    const groupedIds = Object.values(TRANSMISSION_PROFILE_LOCATION_IDS).flat();
    const mappedIds = [...groupedIds, ...NO_INTERTIE_LOCATION_IDS];

    expect(plannedIds).toHaveLength(285);
    expect(groupedIds).toHaveLength(254);
    expect(NO_INTERTIE_LOCATION_IDS).toHaveLength(31);
    expect(new Set(plannedIds).size).toBe(plannedIds.length);
    expect(new Set(mappedIds).size).toBe(mappedIds.length);
    expect([...mappedIds].sort()).toEqual([...plannedIds].sort());
    expect(Object.keys(LOCATION_TRANSMISSION_PROFILE_IDS).sort()).toEqual(
      [...plannedIds].sort(),
    );

    const downloadedIds = Object.keys(weatherIndex.cities);
    expect(downloadedIds).toHaveLength(113);
    expect(
      downloadedIds.every((id) => id in LOCATION_TRANSMISSION_PROFILE_IDS),
    ).toBe(true);
  });

  it("keeps profile records complete, finite, nonnegative, and internally linked", () => {
    const corridorIds = new Set<string>();
    const marketIds = new Set<string>();

    for (const [profileId, [markets, corridors]] of Object.entries(
      TRANSMISSION_PROFILE_DATA,
    )) {
      expect(markets.length).toBeGreaterThan(0);
      expect(corridors.length).toBeGreaterThan(0);
      const profileMarketIds = new Set(markets.map(([id]) => id));

      for (const [id, , , price, supplyW, demandW] of markets) {
        expect(marketIds.has(id)).toBe(false);
        marketIds.add(id);
        expect([price, supplyW, demandW]).toEqual(
          expect.arrayContaining([expect.any(Number)]),
        );
        for (const value of [price, supplyW, demandW]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }

      for (const corridor of corridors) {
        const [
          id,
          adjacentMarketId,
          ,
          routeType,
          capacityW,
          buildCost,
          annualOperatingCost,
          yearsToBuild,
          heatDerateStartsC,
          heatDeratePerC,
          solarDerateFraction,
        ] = corridor;
        expect(corridorIds.has(id)).toBe(false);
        corridorIds.add(id);
        expect(profileMarketIds.has(adjacentMarketId)).toBe(true);
        expect(["EXISTING", "NEW"]).toContain(routeType);
        for (const value of [
          capacityW,
          buildCost,
          annualOperatingCost,
          yearsToBuild,
          heatDerateStartsC,
          heatDeratePerC,
          solarDerateFraction,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }

      expect(profileId in TRANSMISSION_PROFILE_LOCATION_IDS).toBe(true);
    }

    expect(TRANSMISSION_CORRIDORS).toHaveLength(corridorIds.size);
    expect(ADJACENT_MARKETS).toHaveLength(marketIds.size);
    for (const corridor of TRANSMISSION_CORRIDORS) {
      expect(adjacentMarketForCorridor(corridor.id)?.id).toBe(
        corridor.adjacentMarketId,
      );
    }
  });

  it("suppresses islanded and non-connected systems instead of inventing geography", () => {
    const suppressed = [
      "HNL",
      "SJU",
      "Reykjavik",
      "Colombo",
      "Male",
      "Taipei",
      "Seoul",
      "Busan",
      "Suva",
      "PortMoresby",
      "Noumea",
      "Papeete",
      "Honiara",
    ];

    for (const id of suppressed) {
      expect(transmissionAvailable(location(id))).toBe(false);
      expect(corridorsForLocation(location(id))).toEqual([]);
      expect(adjacentMarketsForLocation(location(id))).toEqual([]);
    }

    expect(transmissionAvailable(location("custom-unknown"))).toBe(false);
    expect(corridorsForLocation(location("custom-unknown"))).toEqual([]);
  });

  it("keeps connected islands enabled and proposed-only routes new", () => {
    for (const id of ["Hobart", "Auckland", "Christchurch", "Dublin"]) {
      expect(transmissionAvailable(location(id))).toBe(true);
      expect(corridorsForLocation(location(id)).length).toBeGreaterThan(0);
    }

    for (const id of ["TelAviv", "Luanda", "Yangon", "BandarSeriBegawan"]) {
      expect(corridorsForLocation(location(id))).not.toHaveLength(0);
      expect(corridorsForLocation(location(id))).toEqual(
        expect.arrayContaining([expect.objectContaining({ routeType: "NEW" })]),
      );
      expect(
        corridorsForLocation(location(id)).every(
          ({ routeType }) => routeType === "NEW",
        ),
      ).toBe(true);
    }
  });

  it("preserves the saved California IDs and handles hidden support records", () => {
    expect(corridorsForLocation(location("SF")).map(({ id }) => id)).toEqual([
      "california-north",
      "california-south",
    ]);
    expect(corridorsForLocation(location("CAMountains"))).toEqual(
      corridorsForLocation(location("SF")),
    );
    expect(corridorsForLocation(location("AlleghenyUpper"))).toEqual(
      corridorsForLocation(location("PIT")),
    );
  });

  it("keeps location-specific regional proposals on the correct side of a shared grid", () => {
    expect(
      corridorsForLocation(location("GuatemalaCity")).map(({ id }) => id),
    ).toContain("guatemala-mexico-upgrade");
    expect(
      corridorsForLocation(location("SanSalvador")).map(({ id }) => id),
    ).toEqual(["siepac-honduras-upgrade"]);
    expect(
      corridorsForLocation(location("PanamaCity")).map(({ id }) => id),
    ).toContain("panama-colombia-hvdc-new");
    expect(
      corridorsForLocation(location("SanJoseCR")).map(({ id }) => id),
    ).toEqual(["siepac-panama-upgrade"]);
  });
});
