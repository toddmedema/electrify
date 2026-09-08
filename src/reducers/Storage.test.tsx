import { TICKS_PER_HOUR, TICK_MINUTES, RESERVE_MARGIN } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { createGame } from "../testing/Simulator";
import {
  FacilityOperatingType,
  GeneratorOperatingType,
  StorageOperatingType,
} from "../Types";
import { tickState } from "./Game";

function fixture() {
  const game = createGame({ scenarioId: 103, seed: 44 });
  game.transmission = { lines: [], tradingPolicy: "BALANCED" };
  game.timeline.forEach((t) => {
    t.demandW = 100;
  });
  const base = game.facilities[0];
  const generator = (id: number, peakW = 300): GeneratorOperatingType =>
    ({
      ...base,
      id,
      fuel: "Natural Gas",
      peakW,
      peakWh: undefined,
      currentW: 0,
      yearsToBuildLeft: 0,
      spinMinutes: 1,
      paused: false,
      minimumStableOutput: 0,
      tracksStarts: false,
    }) as GeneratorOperatingType;
  const battery = (
    id: number,
    overrides: Partial<StorageOperatingType> = {},
  ): StorageOperatingType =>
    ({
      ...base,
      id,
      fuel: undefined,
      name: "Battery",
      peakW: 100,
      peakWh: 1000,
      currentW: 0,
      currentWh: 0,
      roundTripEfficiency: 0.8,
      hourlyLoss: 0,
      yearsToBuildLeft: 0,
      spinMinutes: 1,
      paused: false,
      ...overrides,
    }) as StorageOperatingType;
  const run = (facilities: FacilityOperatingType[]) => {
    game.facilities = facilities;
    tickState(game);
    return getTimeFromTimeline(game.date.minute, game.timeline)!;
  };
  return { game, generator, battery, run };
}

describe("storage dispatch energy accounting", () => {
  it("caps grid charging at surplus and counts conversion losses once", () => {
    const { generator, battery, run } = fixture();
    const gen = generator(1, 150),
      store = battery(2);
    const now = run([gen, store]);
    expect(store.currentW).toBe(-40);
    expect(store.currentWh).toBeCloseTo(40 / TICKS_PER_HOUR);
    expect(now.storageLossWh).toBeCloseTo(10 / TICKS_PER_HOUR);
    expect(now.supplyW).toBe(100);
    expect(now.supplyByFuel["Natural Gas"]).toBe(150);
  });
  it("subtracts prior generators from the charge request and respects the grid rating", () => {
    const { generator, battery, run } = fixture();
    const first = generator(1, 150),
      second = generator(2),
      a = battery(3),
      b = battery(4);
    const now = run([first, second, a, b]);
    expect(second.currentW).toBe(150);
    expect(a.currentW).toBe(-80);
    expect(b.currentW).toBe(-80);
    expect(now.supplyW).toBe(100);
  });
  it("removes processed requests across an interleaved dispatch stack", () => {
    const { generator, battery, run } = fixture();
    const first = generator(1, 150),
      second = generator(3),
      a = battery(2),
      b = battery(4);
    const now = run([first, a, second, b]);
    expect(a.currentW).toBe(-40);
    expect(second.currentW).toBe(100);
    expect(b.currentW).toBe(-80);
    expect(now.supplyW).toBe(100);
  });
  it.each([{ paused: true }, { yearsToBuildLeft: 1 }])(
    "ignores unavailable storage %p",
    (overrides) => {
      const { generator, battery, run } = fixture();
      const gen = generator(1),
        store = battery(2, overrides);
      run([gen, store]);
      expect(gen.currentW).toBeCloseTo(100 * (1 + RESERVE_MARGIN));
      expect(store.currentWh).toBe(0);
    },
  );
  it("does not request charging for a battery already passed in dispatch order", () => {
    const { generator, battery, run } = fixture();
    const gen = generator(2),
      store = battery(1);
    run([store, gen]);
    expect(gen.currentW).toBeCloseTo(100 * (1 + RESERVE_MARGIN));
    expect(store.currentWh).toBe(0);
  });
  it("caps a nearly full battery at its remaining energy room", () => {
    const { generator, battery, run } = fixture();
    const store = battery(2, { currentWh: 999 });
    const now = run([generator(1), store]);
    expect(store.currentWh).toBe(1000);
    expect(now.storageLossWh).toBeCloseTo(0.25);
    expect(now.supplyW).toBeCloseTo(100);
    expect(store.currentW).toBeCloseTo(-60 / TICK_MINUTES);
  });
  it("uses net supply when a final generator follows charging storage", () => {
    const { generator, battery, run } = fixture();
    const final = generator(3);
    const now = run([generator(1, 150), battery(2), final]);
    expect(final.currentW).toBeCloseTo(100 * RESERVE_MARGIN);
    expect(now.supplyW).toBeCloseTo(100 * (1 + RESERVE_MARGIN));
  });
  it("returns only the stored energy on discharge without charging losses twice", () => {
    const { game, generator, battery, run } = fixture();
    const store = battery(2);
    const charged = run([generator(1, 150), store]);
    expect(charged.storageLossWh).toBeCloseTo(10 / TICKS_PER_HOUR);
    game.facilities = [store];
    tickState(game);
    const discharged = getTimeFromTimeline(game.date.minute, game.timeline)!;
    expect(discharged.supplyW).toBeCloseTo(40);
    expect(store.currentWh).toBe(0);
    expect(discharged.storageLossWh).toBe(0);
  });
  it.each([
    { mode: "charging", importedW: 0, exportedW: 0, revenueFraction: 1 },
    {
      mode: "export",
      importedW: 0,
      exportedW: 125 - 100 * (1 + RESERVE_MARGIN),
      revenueFraction: 1,
    },
    { mode: "import", importedW: 50, exportedW: 0, revenueFraction: 0.5 },
  ])(
    "does not over-credit facility revenue during $mode",
    ({ mode, importedW, exportedW, revenueFraction }) => {
      const { game, generator, battery, run } = fixture();
      game.transmission!.lines = [
        {
          id: 10,
          corridorId: "california-north",
          name: "Test intertie",
          capacityW: 1000,
          buildCost: 0,
          annualOperatingCost: 0,
          yearsToBuildLeft: 0,
          minuteCreated: 0,
          financed: false,
          loanAmountLeft: 0,
          loanMonthlyPayment: 0,
          interestRate: 0,
        },
      ];
      const gen = generator(1, mode === "import" ? 50 : 300);
      if (mode === "export") {
        gen.currentW = 300;
        gen.spinMinutes = 60;
      }
      const fleet = mode === "import" ? [gen] : [gen, battery(2)];
      const revenueBefore = fleet.reduce(
        (sum, f) => sum + f.lifetimeRevenue,
        0,
      );
      const now = run(fleet);
      const credited =
        fleet.reduce((sum, f) => sum + f.lifetimeRevenue, 0) - revenueBefore;
      expect(credited).toBeLessThanOrEqual(now.revenue + 1e-6);
      expect(credited).toBeGreaterThan(0);
      expect(now.importedW).toBe(importedW);
      expect(now.exportedW).toBeCloseTo(exportedW);
      expect(credited).toBeCloseTo(now.revenue * revenueFraction);
      const gridChargeW = fleet.reduce(
        (sum, f) =>
          sum + (f.currentW < 0 ? -f.currentW / f.roundTripEfficiency : 0),
        0,
      );
      expect(now.supplyW).toBeCloseTo(
        gen.currentW - gridChargeW + importedW - exportedW,
      );
    },
  );
});
