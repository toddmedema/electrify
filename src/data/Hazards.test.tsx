import { readFileSync } from "fs";
import { join } from "path";
import { LocationType, WeatherHazardProfileType } from "../Types";
import { LOCATIONS } from "../Constants";
import { SCENARIOS } from "./Scenarios";
import {
  coldPackageDesignMinTempC,
  getWeatherHazardProfile,
  NORTHERN_HAIL_MONTHLY_WEIGHTS,
  regionalColdThresholdC,
  validateWeatherHazardProfile,
  WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS,
  WEATHER_HAZARD_PROFILES,
  WEATHER_HAZARD_TUTORIAL_SCENARIOS,
} from "./Hazards";

function at(id: string, lat: number, elevation?: number): LocationType {
  return { id, name: id, lat, long: 0, elevation };
}

const profile = (id: string) => getWeatherHazardProfile(at(id, 40));

describe("weather hazard profile data", () => {
  it("only profiles locations the game can actually load", () => {
    const weatherIndex = JSON.parse(
      readFileSync(
        join(process.cwd(), "public/data/weather/index.json"),
        "utf8",
      ),
    ) as { cities: Record<string, unknown> };
    const known = new Set([
      ...Object.keys(LOCATIONS),
      ...Object.keys(weatherIndex.cities),
    ]);
    expect(
      Object.keys(WEATHER_HAZARD_PROFILES).filter((id) => !known.has(id)),
    ).toEqual([]);
  });

  it("lists exactly the tutorial scenarios as hazard-free", () => {
    const tutorials = SCENARIOS.filter((s) => s.tutorialSteps).map((s) => s.id);
    expect(
      [...WEATHER_HAZARD_TUTORIAL_SCENARIOS].sort((a, b) => a - b),
    ).toEqual(tutorials.sort((a, b) => a - b));
  });

  it("names real scenarios with authored freezes", () => {
    WEATHER_HAZARD_AUTHORED_FREEZE_SCENARIOS.forEach((id) => {
      expect(SCENARIOS.some((s) => s.id === id)).toBe(true);
    });
  });

  it("keeps a normalized northern hail season", () => {
    expect(NORTHERN_HAIL_MONTHLY_WEIGHTS).toHaveLength(12);
    const sum = NORTHERN_HAIL_MONTHLY_WEIGHTS.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(NORTHERN_HAIL_MONTHLY_WEIGHTS[0]).toBe(0); // No January convection
  });

  it("ranks hail alley above the Northeast, the coast and the subarctic", () => {
    const rate = (id: string) => profile(id).damagingHailPerYear;
    expect(rate("Denver")).toBeGreaterThan(rate("PIT"));
    expect(rate("PIT")).toBeGreaterThan(rate("SF"));
    expect(rate("SF")).toBeGreaterThan(rate("Reykjavik"));
  });

  it("falls back by latitude and altitude for unprofiled locations", () => {
    expect(getWeatherHazardProfile(at("x", 70)).damagingHailPerYear).toBe(
      0.002,
    );
    expect(getWeatherHazardProfile(at("x", -5)).damagingHailPerYear).toBe(
      0.005,
    );
    expect(getWeatherHazardProfile(at("x", 35)).damagingHailPerYear).toBe(0.01);
    expect(getWeatherHazardProfile(at("x", 50)).coldClimate).toBe(true);
    expect(getWeatherHazardProfile(at("x", 35, 2000)).coldClimate).toBe(true);
    // High but tropical, like Mexico City, is not a cold climate.
    expect(getWeatherHazardProfile(at("x", 19, 2230)).coldClimate).toBe(false);
    expect(getWeatherHazardProfile(at("x", 35, 100)).coldClimate).toBe(false);
  });

  it("resolves regional thresholds and cold-weather package ratings", () => {
    expect(regionalColdThresholdC(profile("Dallas"))).toBe(-8);
    expect(regionalColdThresholdC(profile("PIT"))).toBe(-25);
    expect(regionalColdThresholdC(profile("Fairbanks"))).toBe(-40);
    expect(coldPackageDesignMinTempC(profile("Dallas"))).toBe(-25);
    expect(coldPackageDesignMinTempC(profile("PIT"))).toBe(-30);
    expect(coldPackageDesignMinTempC(profile("Minneapolis"))).toBe(-35);
  });

  it("rejects malformed profiles", () => {
    const good: WeatherHazardProfileType = {
      damagingHailPerYear: 0.01,
      coldClimate: false,
      source: "test",
    };
    expect(() => validateWeatherHazardProfile(good)).not.toThrow();
    expect(() =>
      validateWeatherHazardProfile({ ...good, damagingHailPerYear: -1 }),
    ).toThrow(/damagingHailPerYear/);
    expect(() =>
      validateWeatherHazardProfile({ ...good, regionalColdThresholdC: 5 }),
    ).toThrow(/regionalColdThresholdC/);
    expect(() => validateWeatherHazardProfile({ ...good, source: "" })).toThrow(
      /source/,
    );
  });
});
