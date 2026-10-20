import type {
  DeferredResidentialLoad,
  LocationType,
  PolicyProgramType,
} from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import {
  shiftThermalDemand,
  thermalCapitalCostPerCustomer,
  thermalEligibility,
  thermalFleet,
  thermalMonthlyRewardPerCustomer,
  validDeferredThermal,
} from "./ThermalFlexibility";

const location: LocationType = {
  id: "AKL",
  name: "Auckland",
  country: "New Zealand",
  lat: -36.85,
  long: 174.76,
};
const program: PolicyProgramType = {
  tier: "On",
  adoption: 1,
  spending: 0,
  spent: 0,
  installs: [[1, 1]],
};
const input = {
  residentialW: 1000,
  weatherShare: 0.5,
  temperatureC: 5,
  location,
  startingYear: 2025,
  program,
};

test("1980 permits water control but cannot acquire 2025 smart heating", () => {
  const oldFleet = thermalFleet(location, program, 1980);
  const modernFleet = thermalFleet(location, program, 2025);
  expect(oldFleet.hotWaterLoadShare).toBeGreaterThan(0);
  expect(oldFleet.weatherControlShare).toBe(0);
  expect(modernFleet.weatherControlShare).toBeGreaterThan(0);
  const mixed = thermalFleet(
    location,
    {
      ...program,
      installs: [
        [1, 0.5],
        [540, 0.5],
      ],
    },
    1980,
  );
  expect(mixed.weatherControlShare).toBeCloseTo(
    modernFleet.weatherControlShare / 2,
  );
  // A cohort installed at month twelve gets the next year's technology, matching game dates.
  const december = thermalFleet(
    location,
    { ...program, installs: [[11, 1]] },
    2014,
  );
  const january = thermalFleet(
    location,
    { ...program, installs: [[12, 1]] },
    2014,
  );
  expect(january.weatherControlShare).toBeGreaterThan(
    december.weatherControlShare,
  );
});

test("space heating controls never shift cooling, and reduced native demand limits shifting", () => {
  const heating = shiftThermalDemand({ ...input, minute: 17 * 60 });
  const cooling = shiftThermalDemand({
    ...input,
    minute: 17 * 60,
    temperatureC: 30,
  });
  expect(heating.shiftedW).toBeGreaterThan(cooling.shiftedW);
  expect(
    shiftThermalDemand({ ...input, minute: 17 * 60, residentialW: 0 }).shiftedW,
  ).toBe(0);
  const efficient = shiftThermalDemand({
    ...input,
    minute: 17 * 60,
    residentialW: 600,
  });
  expect(efficient.shiftedW).toBeCloseTo(heating.shiftedW * 0.6);
  expect(thermalEligibility(location, 1980, 1, 5)).toBe(0);
  expect(thermalEligibility(location, 2025, 1, 30)).toBe(0);
});

function simulate(stepMinutes: number, startHour = 17) {
  let deferred: DeferredResidentialLoad[] = [];
  let energyWh = 0;
  let greatestQueueWh = 0;
  for (let minute = 0; minute < 2 * MINUTES_PER_MONTH; minute += stepMinutes) {
    // Disable at midnight after the first representative day; carry debt into the next month.
    const tier = minute < MINUTES_PER_MONTH ? "On" : "Off";
    const result = shiftThermalDemand({
      ...input,
      minute,
      program: { ...program, tier, startHour },
      stepMinutes,
      deferred,
    });
    deferred = result.deferred;
    energyWh += (result.residentialW * stepMinutes) / 60;
    greatestQueueWh = Math.max(
      greatestQueueWh,
      deferred.reduce((sum, batch) => sum + batch.energyWh, 0),
    );
    expect(result.residentialW).toBeGreaterThanOrEqual(0);
    expect(deferred.length).toBeLessThanOrEqual(1);
  }
  expect(greatestQueueWh).toBeGreaterThan(0);
  expect(deferred).toEqual([]);
  expect(energyWh).toBeCloseTo(48000, 6);
  return energyWh;
}

test("all deferred energy recovers at 15- and 60-minute resolution", () => {
  expect(simulate(15)).toBeCloseTo(simulate(60), 6);
});

test("the original recovery window survives Off and a month-boundary window change", () => {
  expect(simulate(15, 23)).toBeCloseTo(simulate(60, 23), 6);
  const first = shiftThermalDemand({
    ...input,
    minute: 23 * 60,
    program: { ...program, startHour: 23 },
  });
  const copy = JSON.parse(JSON.stringify(first.deferred));
  const changed = shiftThermalDemand({
    ...input,
    minute: MINUTES_PER_MONTH + 3 * 60,
    program: { ...program, tier: "Off", startHour: 5 },
    deferred: first.deferred,
  });
  expect(changed.recoveredW).toBeGreaterThan(0);
  expect(changed.shiftedW).toBe(0);
  expect(changed.deferred[0].recoveryStartMinute).toBe(27 * 60);
  expect(first.deferred).toEqual(copy);
});

test("a tick spanning the peak/recovery boundary cannot lose energy", () => {
  const result = shiftThermalDemand({
    ...input,
    minute: 20 * 60 + 45,
    stepMinutes: 60,
  });
  const queuedWh = result.deferred.reduce(
    (sum, entry) => sum + entry.energyWh,
    0,
  );
  expect(result.residentialW + queuedWh).toBeCloseTo(input.residentialW);
  expect(result.shiftedW).toBeGreaterThan(0);
  expect(result.recoveredW).toBeGreaterThan(0);
});

test("payments follow installed equipment and stop when dispatch is disabled", () => {
  const half: PolicyProgramType = {
    ...program,
    adoption: 0.5,
    installs: [[1, 0.5]],
  };
  expect(thermalCapitalCostPerCustomer(location, 1940)).toBe(0);
  expect(thermalCapitalCostPerCustomer(location, 2025)).toBeGreaterThan(
    thermalCapitalCostPerCustomer(location, 1980),
  );
  expect(thermalMonthlyRewardPerCustomer(location, half, 2025)).toBeCloseTo(
    thermalMonthlyRewardPerCustomer(location, program, 2025) / 2,
  );
  expect(
    thermalMonthlyRewardPerCustomer(
      location,
      { ...program, tier: "Off" },
      2025,
    ),
  ).toBe(0);
});

test("import validation rejects malformed debt, and overdue valid debt is repaid", () => {
  const valid = {
    energyWh: 10,
    recoveryStartMinute: 0,
    recoveryEndMinute: 180,
  };
  expect(validDeferredThermal([valid])).toBe(true);
  expect(validDeferredThermal([{ ...valid, energyWh: -1 }])).toBe(false);
  expect(validDeferredThermal([{ ...valid, recoveryEndMinute: 181 }])).toBe(
    false,
  );
  expect(validDeferredThermal([{ ...valid, energyWh: Infinity }])).toBe(false);
  expect(validDeferredThermal({})).toBe(false);
  const overdue = shiftThermalDemand({
    ...input,
    minute: 300,
    deferred: [valid],
    program: { ...program, tier: "Off" },
    stepMinutes: 60,
  });
  expect(overdue.deferred).toEqual([]);
  expect(overdue.residentialW).toBe(1010);
  expect(() =>
    shiftThermalDemand({ ...input, minute: 0, stepMinutes: 0 }),
  ).toThrow("positive finite step");
});
