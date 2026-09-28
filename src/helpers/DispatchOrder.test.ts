import { defaultDispatchIndex, isPeakingPlant } from "./DispatchOrder";

const peaker = { gasCycle: "simple" as const };
const cc = { gasCycle: "combined" as const };
const coal = {};
const battery = { peakWh: 400 };

describe("default dispatch order", () => {
  it("treats only simple-cycle gas as a peaker", () => {
    expect(isPeakingPlant(peaker)).toBe(true);
    expect(isPeakingPlant(cc)).toBe(false);
    expect(isPeakingPlant(coal)).toBe(false);
    expect(isPeakingPlant(battery)).toBe(false);
  });

  it("puts a new combined cycle, or any other generator, at the top", () => {
    expect(defaultDispatchIndex([coal, peaker, battery], cc)).toBe(0);
    expect(defaultDispatchIndex([cc, peaker], coal)).toBe(0);
  });

  it("puts a new peaker above existing peakers and storage, below everything else", () => {
    expect(defaultDispatchIndex([cc, coal, peaker, battery], peaker)).toBe(2);
    expect(defaultDispatchIndex([cc, coal, battery], peaker)).toBe(2);
    expect(defaultDispatchIndex([cc, coal], peaker)).toBe(2);
    expect(defaultDispatchIndex([], peaker)).toBe(0);
  });

  it("respects an order the player arranged", () => {
    // A peaker the player moved to the top still marks where the peakers begin
    expect(defaultDispatchIndex([peaker, cc, coal], peaker)).toBe(0);
  });

  it("appends storage", () => {
    expect(defaultDispatchIndex([cc, peaker], battery)).toBe(2);
  });
});
