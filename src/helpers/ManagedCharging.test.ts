import type { DeferredResidentialLoad, LocationType } from "../Types";
import { shiftManagedCharging } from "./ManagedCharging";

const city: LocationType = {
  id: "EV",
  name: "EV",
  lat: 0,
  long: 0,
  country: "United States",
  region: "North America",
};
const base = {
  transportationW: 10000,
  customers: 10000,
  year: 2025,
  location: city,
  enrollment: 0.5,
};

test("preserves historical electric transport, opt-outs, and non-peak charging", () => {
  for (const override of [
    { year: 1980 },
    { year: 2010 },
    { enrollment: 0 },
    { customers: 0 },
    { transportationW: 0 },
  ]) {
    const input = { ...base, minute: 18 * 60, ...override };
    const result = shiftManagedCharging(input);
    expect(result.shiftedW).toBe(0);
    expect(result.transportationW).toBe(input.transportationW);
    expect(result.deferred).toEqual([]);
  }
  expect(shiftManagedCharging({ ...base, minute: 12 * 60 }).shiftedW).toBe(0);
});

test("moves a bounded share of existing EV charging, leaving rail and overrides intact", () => {
  const result = shiftManagedCharging({ ...base, minute: 18 * 60 });
  expect(result.shiftedW).toBeGreaterThan(0);
  expect(result.shiftedW).toBeLessThan(base.transportationW * 0.2);
  expect(result.transportationW).toBe(base.transportationW - result.shiftedW);
  expect(result.deferred).toHaveLength(1);
  expect(result.deferred[0].recoveryEndMinute).toBe(27 * 60);
  const early = shiftManagedCharging({ ...base, year: 2015, minute: 18 * 60 });
  expect(early.shiftedW).toBeLessThan(result.shiftedW / 10);
  const tinyFleet = shiftManagedCharging({
    ...base,
    customers: 1,
    minute: 18 * 60,
  });
  expect(tinyFleet.shiftedW).toBeLessThan(2);
});

test.each([17, 22])(
  "conserves energy across midnight/month and cancellation for a %i:00 window",
  (startHour) => {
    let queue: DeferredResidentialLoad[] = [];
    let removedWh = 0;
    let returnedWh = 0;
    let netWh = 0;
    for (
      let minute = startHour * 60;
      minute < (startHour + 11) * 60;
      minute += 15
    ) {
      const result = shiftManagedCharging({
        ...base,
        minute,
        startHour,
        enrollment: minute < 1440 ? 0.5 : 0,
        deferred: queue,
      });
      queue = result.deferred;
      removedWh += result.shiftedW / 4;
      returnedWh += result.recoveredW / 4;
      netWh += result.transportationW / 4;
      expect(result.transportationW).toBeGreaterThanOrEqual(0);
    }
    expect(removedWh).toBeGreaterThan(0);
    expect(returnedWh).toBeCloseTo(removedWh, 7);
    expect(netWh).toBeCloseTo(base.transportationW * 11, 7);
    expect(queue).toEqual([]);
  },
);

test("keeps original deadlines and does not mutate the caller's live/forecast state", () => {
  const deferred: DeferredResidentialLoad[] = [
    { energyWh: 600, recoveryStartMinute: 21 * 60, recoveryEndMinute: 27 * 60 },
  ];
  const result = shiftManagedCharging({
    ...base,
    minute: 23 * 60,
    enrollment: 0,
    startHour: 8,
    deferred,
  });
  expect(deferred[0].energyWh).toBe(600);
  expect(result.recoveredW).toBeGreaterThan(0);
  expect(result.shiftedW).toBe(0);
  expect(result.deferred[0].recoveryEndMinute).toBe(27 * 60);
  expect(result.deferred[0].energyWh + result.recoveredW / 4).toBeCloseTo(600);
});

test("returns overdue obligations after a time jump and handles invalid steps without dropping them", () => {
  const deferred: DeferredResidentialLoad[] = [
    { energyWh: 600, recoveryStartMinute: 100, recoveryEndMinute: 460 },
  ];
  const jumped = shiftManagedCharging({
    ...base,
    minute: 500,
    enrollment: 0,
    deferred,
  });
  expect(jumped.recoveredW / 4).toBe(600);
  expect(jumped.deferred).toEqual([]);
  for (const stepMinutes of [0, -15, Number.NaN]) {
    const invalid = shiftManagedCharging({
      ...base,
      minute: 500,
      deferred,
      stepMinutes,
    });
    expect(invalid.deferred).toEqual(deferred);
    expect(invalid.recoveredW).toBe(0);
  }
});

test("a zero-length peak overlap creates no obligation and partial overlaps conserve energy", () => {
  const outside = shiftManagedCharging({ ...base, minute: 21 * 60 });
  expect(outside.shiftedW).toBe(0);
  const full = shiftManagedCharging({
    ...base,
    minute: 20 * 60 + 45,
    stepMinutes: 15,
  });
  const partial = shiftManagedCharging({
    ...base,
    minute: 20 * 60 + 45,
    stepMinutes: 30,
  });
  expect(partial.shiftedW).toBeCloseTo(full.shiftedW / 2);
  expect(partial.shiftedW / 2).toBeCloseTo(
    partial.deferred.reduce((sum, entry) => sum + entry.energyWh, 0) +
      partial.recoveredW / 2,
  );
  const entering = shiftManagedCharging({
    ...base,
    minute: 16 * 60 + 45,
    stepMinutes: 30,
  });
  expect(entering.shiftedW).toBeCloseTo(full.shiftedW / 2);
  expect(entering.deferred[0].energyWh).toBeCloseTo(entering.shiftedW / 2);
});
