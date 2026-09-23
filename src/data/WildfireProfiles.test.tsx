import { WildfireProfileType } from "../Types";
import {
  allWildfireProfiles,
  getWildfireProfile,
  validateWildfireProfile,
} from "./WildfireProfiles";

describe("wildfire profile data", () => {
  it("ships reviewed profiles for the California service areas only", () => {
    expect(getWildfireProfile("LA")).toBeDefined();
    expect(getWildfireProfile("SF")).toBeDefined();
    // Unknown or non-profiled areas carry no inferred risk.
    expect(getWildfireProfile("PIT")).toBeUndefined();
    expect(getWildfireProfile("HNL")).toBeUndefined();
    expect(getWildfireProfile(undefined)).toBeUndefined();
  });

  it("keeps every shipped profile structurally valid", () => {
    const profiles = allWildfireProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    profiles.forEach((profile) => {
      expect(() => validateWildfireProfile(profile)).not.toThrow();
    });
  });

  it("allows winter wind events in Southern California", () => {
    const la = getWildfireProfile("LA")!;
    // January (index 0) must carry a material weight so the winter wind lesson is reachable.
    expect(la.monthlyWeights[0]).toBeGreaterThan(1 / 12);
  });

  it("concentrates risk in a seasonal window rather than spreading it evenly", () => {
    const la = getWildfireProfile("LA")!;
    const max = Math.max(...la.monthlyWeights);
    const min = Math.min(...la.monthlyWeights);
    // A real season has a peak well above its trough.
    expect(max).toBeGreaterThan(min * 3);
  });

  it("rejects weights that do not sum to one", () => {
    const bad: WildfireProfileType = {
      ...getWildfireProfile("LA")!,
      monthlyWeights: [1 / 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(() => validateWildfireProfile(bad)).toThrow(/sum to one/);
  });

  it("rejects out-of-range severity bounds", () => {
    const bad: WildfireProfileType = {
      ...getWildfireProfile("LA")!,
      disconnectedDemand: { min: 0, max: 1.5 },
    };
    expect(() => validateWildfireProfile(bad)).toThrow(/disconnectedDemand/);
  });

  it("rejects a negative annual hazard", () => {
    const bad: WildfireProfileType = {
      ...getWildfireProfile("LA")!,
      annualHazard: -1,
    };
    expect(() => validateWildfireProfile(bad)).toThrow(/annualHazard/);
  });

  it("rejects a wrong-length weight vector", () => {
    const bad: WildfireProfileType = {
      ...getWildfireProfile("LA")!,
      monthlyWeights: [1 / 12, 1 / 12],
    };
    expect(() => validateWildfireProfile(bad)).toThrow(/twelve/);
  });
});
