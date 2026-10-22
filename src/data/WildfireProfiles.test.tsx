import { WildfireProfileType } from "../Types";
import smokeHistory from "./WildfireSmokeHistory.json";
import {
  allWildfireProfiles,
  getWildfireProfile,
  validateWildfireProfile,
} from "./WildfireProfiles";

const LA = getWildfireProfile("LA")!;

describe("sourced wildfire smoke profiles", () => {
  it("exposes only reviewed canonical cities", () => {
    expect(
      allWildfireProfiles()
        .map((profile) => profile.locationId)
        .sort(),
    ).toEqual(["LA", "SF"]);
    for (const location of [undefined, "PIT", "HNL", "custom"]) {
      expect(getWildfireProfile(location)).toBeUndefined();
    }
    allWildfireProfiles().forEach((profile) =>
      expect(() => validateWildfireProfile(profile)).not.toThrow(),
    );
  });

  it("retains complete source years and original source hashes", () => {
    expect(LA.sourceYears).toEqual([
      2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
    ]);
    for (const year of smokeHistory.years) {
      const days =
        (Date.UTC(year.year + 1, 0, 1) - Date.UTC(year.year, 0, 1)) / 86400000;
      expect(year.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(year.source.bytes).toBeGreaterThan(0);
      for (const location of ["LA", "SF"] as const) {
        const history = year.locations[location];
        expect(history.dailyDensity).toHaveLength(days);
        expect(history.dailyDensity).toMatch(/^[0-3?]+$/);
        expect(
          [...history.dailyDensity].filter((value) => value === "?"),
        ).toHaveLength(year.daysWithoutArchivePolygons.length);
        expect(
          history.detectedDaysByMonth.reduce((sum, value) => sum + value, 0),
        ).toBe(
          [...history.dailyDensity].filter((value) => "123".includes(value))
            .length,
        );
      }
    }
  });

  it("keeps unavailable dates distinct from no local detection", () => {
    const source = smokeHistory.years.find((year) => year.year === 2017)!;
    expect(source.daysWithoutArchivePolygons).toEqual([316]);
    expect(source.locations.LA.dailyDensity[315]).toBe("?");
    expect(source.locations.SF.dailyDensity[315]).toBe("?");
    expect(source.locations.LA.dailyDensity).toContain("0");
  });

  it("uses the regional daytime GHI reference rather than generic generator limits", () => {
    expect(LA.dailyReferenceAttenuation).toEqual([
      0.19, 0.18, 0.12, 0.16, 0.16,
    ]);
    expect(getWildfireProfile("SF")!.dailyReferenceAttenuation).toEqual([
      0.23, 0.22, 0.17, 0.15, 0.1,
    ]);
    expect([LA.localStartHour, LA.localEndHour]).toEqual([10, 18]);
    expect(LA).not.toHaveProperty("annualHazard");
    expect(LA).not.toHaveProperty("outputMultiplier");
    expect(LA).not.toHaveProperty("disconnectedDemand");
  });

  it.each<[string, Partial<WildfireProfileType>, RegExp]>([
    ["empty years", { sourceYears: [] }, /sourceYears/],
    ["unreviewed year", { sourceYears: [2016] }, /sourceYears/],
    ["duplicate years", { sourceYears: [2020, 2020] }, /sourceYears/],
    ["negative loss", { dailyReferenceAttenuation: [-0.1] }, /ratios/],
    ["excess loss", { dailyReferenceAttenuation: [1.1] }, /ratios/],
    ["empty losses", { dailyReferenceAttenuation: [] }, /ratios/],
    ["reversed hours", { localStartHour: 18, localEndHour: 10 }, /window/],
    ["fractional hour", { localStartHour: 10.5 }, /window/],
  ])("rejects %s", (_label, change, error) => {
    const profile: WildfireProfileType = { ...LA, ...change };
    expect(() => validateWildfireProfile(profile)).toThrow(error);
  });
});
