import cloneDeep from "lodash.clonedeep";
import { EMPTY_HISTORY, MINUTES_PER_MONTH } from "./DateTime";
import { buildStorySnapshot, storyOutputMultiplier } from "./Story";
import { MonthlyHistoryType } from "../Types";
import { createGame } from "../testing/Simulator";

function month(index: number): MonthlyHistoryType {
  return {
    ...EMPTY_HISTORY,
    month: index,
    demandWh: 100,
    supplyWh: 90,
    revenue: 20,
    expensesFuel: 2,
    expensesOM: 3,
    expensesCarbonFee: 1,
    expensesInterest: 4,
    deliveredWhByFuel: { Coal: index, Wind: index * 2 },
    peakDemandW: index * 1000,
  };
}

describe("storyOutputMultiplier", () => {
  const coal = { id: 3, fuel: "Coal" as const };

  it("multiplies the fuel and facility derates", () => {
    expect(
      storyOutputMultiplier(coal, {
        facilityOutputMultipliersByFuel: { Coal: 0.5 },
        facilityOutputMultipliersById: { "3": 0.5 },
      }),
    ).toBe(0.25);
  });

  it("treats only a missing derate as no limit", () => {
    expect(storyOutputMultiplier(coal, {})).toBe(1);
    expect(
      storyOutputMultiplier(coal, {
        facilityOutputMultipliersById: { "4": 0 },
      }),
    ).toBe(1);
  });

  it("keeps a multiplier of 0 as a full outage", () => {
    expect(
      storyOutputMultiplier(coal, {
        facilityOutputMultipliersById: { "3": 0 },
      }),
    ).toBe(0);
    expect(
      storyOutputMultiplier(coal, {
        facilityOutputMultipliersByFuel: { Coal: 0 },
      }),
    ).toBe(0);
  });
});

describe("story snapshots", () => {
  it("summarizes only the prior twelve completed months", () => {
    const history = Array.from({ length: 14 }, (_, index) => month(index + 1));
    const snapshot = buildStorySnapshot(history, [], 0);
    expect(snapshot.demandWh12m).toEqual(1200);
    expect(snapshot.unservedWh12m).toEqual(120);
    expect(snapshot.netIncome12m).toEqual(120);
    expect(snapshot.deliveredWhByFuel12m).toEqual({
      Coal: 78,
      Wind: 156,
    });
    expect(snapshot.peakDemandW12m).toEqual(12000);
  });

  it("derives firm, storage and per-facility facts from the current fleet", () => {
    const game = createGame({ scenarioId: 103 });
    const coal = game.facilities.find((facility) => facility.fuel === "Coal")!;
    const wind = cloneDeep(coal);
    wind.id = coal.id + 1;
    wind.name = "Wind";
    wind.fuel = "Wind";
    wind.peakW = 50;
    wind.minuteOperational = 0;
    const storage = cloneDeep(coal);
    storage.id = coal.id + 2;
    storage.name = "Battery";
    storage.peakW = 25;
    storage.peakWh = 100;
    storage.minuteOperational = 0;
    game.facilities = [coal, wind, storage];

    const currentMinute = 2 * 12 * MINUTES_PER_MONTH;
    const snapshot = buildStorySnapshot([], game.facilities, currentMinute);
    expect(snapshot.firmPeakW).toEqual(coal.peakW);
    expect(snapshot.storagePeakW).toEqual(25);
    expect(snapshot.storagePeakWh).toEqual(100);
    expect(
      snapshot.facilities.find((facility) => facility.id === coal.id),
    ).toMatchObject({ fuel: "Coal", operational: true });
    expect(
      snapshot.facilities.find((facility) => facility.id === wind.id)?.ageYears,
    ).toBeCloseTo(2, 1);
    expect(
      buildStorySnapshot([], [...game.facilities].reverse(), currentMinute),
    ).toEqual(snapshot);
  });
});
