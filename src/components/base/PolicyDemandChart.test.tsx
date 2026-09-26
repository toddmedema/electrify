import { demandRange } from "./PolicyDemandChart";

describe("demandRange", () => {
  it("fits the axis to the curves so a small program change is visible", () => {
    const [min, max] = demandRange(900e6, 1000e6);
    expect(min).toBeCloseTo(890e6);
    expect(max).toBeCloseTo(1010e6);
  });

  it("never runs below zero", () => {
    expect(demandRange(1e6, 100e6)[0]).toBe(0);
  });

  it("still gives a flat day some height", () => {
    const [min, max] = demandRange(500, 500);
    expect(max).toBeGreaterThan(min);
  });
});
