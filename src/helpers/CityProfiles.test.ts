import type { TerritoryId } from "../Types";
import { territoryTileAt } from "../data/TerritoryTiles";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { cityCustomerCount, cityProfile } from "./CityProfiles";

const cityIds: TerritoryId[] = [
  "champlain",
  "valley-electric",
  "ridge-electric",
  "parcel-1",
  "parcel-5",
];
it.each(cityIds)(
  "derives a mixed city %s reproducibly from seed and identity",
  (id) => {
    const profile = cityProfile(188, id)!;
    // Calling other cities and seeds must never advance a hidden random stream.
    cityProfile(789, "parcel-11");
    expect(cityProfile(188, id)).toEqual(profile);
    expect(cityProfile(189, id)!.energyShares).not.toEqual(
      profile.energyShares,
    );
    expect(
      Object.values(profile.energyShares).every((share) => share > 0),
    ).toBe(true);
    expect(
      Object.values(profile.energyShares).reduce(
        (sum, share) => sum + share,
        0,
      ),
    ).toBeCloseTo(1, 14);
    expect(profile.customers).toBe(cityCustomerCount(id));
  },
);
it("varies nearby mixed cities independently, including equal-sized cities", () => {
  expect(cityProfile(188, "parcel-1")!.energyShares).not.toEqual(
    cityProfile(188, "parcel-9")!.energyShares,
  );
  expect(cityProfile(188, "parcel-5")!.energyShares).not.toEqual(
    cityProfile(188, "parcel-11")!.energyShares,
  );
});
it("gives the three visible size tiers increasing account counts and aggregate load", () => {
  const profiles = ["parcel-5", "parcel-1", "ridge-electric"].map((id) =>
    cityProfile(188, id as TerritoryId)!,
  );
  expect(profiles.map(({ size }) => size)).toEqual([
    "small",
    "medium",
    "large",
  ]);
  for (let index = 1; index < profiles.length; index++) {
    const before = profiles[index - 1],
      after = profiles[index];
    expect(after.customers).toBeGreaterThan(before.customers);
    expect(after.customers * after.demandScale).toBeGreaterThan(
      before.customers * before.demandScale,
    );
  }
  expect(profiles.map(({ customers }) => customers)).toEqual([
    400, 16000, 50000,
  ]);
});
it.each(Object.values(UTILITY_AREAS))(
  "retains $id customer and aggregate demand calibration",
  (area) => {
    const profile = cityProfile(188, area.id)!;
    expect(profile.customers).toBe(area.customers);
    expect(profile.demandScale).toBe(area.demandScale);
    expect(profile.demandShapeExponent).toBe(area.demandShapeExponent);
    for (const sector of ["Residential", "Commercial", "Industrial"] as const) {
      expect(profile.energyShares[sector]).toBeGreaterThan(
        area.energyShares[sector] * 0.8,
      );
      expect(profile.energyShares[sector]).toBeLessThan(
        area.energyShares[sector] * 1.25,
      );
    }
  },
);
it("sizes generated settlements from their simulated service accounts", () => {
  const generated = Array.from({ length: 200 }, (_, q) =>
    territoryTileAt(q + 10, 10),
  ).find((tile) => tile?.city)!;
  expect(generated.city!.size).toBe(
    cityProfile(188, generated.territoryId)!.size,
  );
  expect(cityProfile(188, "green-uplands")).toBeUndefined();
});
