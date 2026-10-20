import type { PolicyProgramType } from "../Types";
import {
  batteryEligibleHouseholdShare,
  batteryCohortHouseholds,
  batteryEnrollmentShare,
  batteryRebateCost,
  CUSTOMER_BATTERIES,
  residentialBatteryCostPerWh,
} from "../data/CustomerBatteries";
import {
  batteryMonthlyCompensation,
  customerBatteryFleet,
  dispatchCustomerBattery,
} from "./CustomerBatteries";

const location = { country: "Australia", region: "Oceania" };
const program: PolicyProgramType = {
  tier: "On",
  adoption: 1,
  spending: 0,
  spent: 0,
  installs: [[1, 1]],
};
const fleet = {
  installedHouseholds: 1,
  enrolledHouseholds: 1,
  installedPowerW: 5000,
  installedCapacityWh: 10000,
  powerW: 5000,
  capacityWh: 10000,
  reserveWh: 2000,
};

test("modern home batteries do not exist in 1980 and have only a tiny addressable 2015 market", () => {
  expect(batteryEligibleHouseholdShare(1980, location)).toBe(0);
  expect(batteryRebateCost(100000, 1, 1980, location)).toBe(0);
  const early = batteryEligibleHouseholdShare(2015, location);
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(0.001);
  expect(batteryEligibleHouseholdShare(2025, location)).toBeGreaterThan(
    early * 50,
  );
  expect(batteryEnrollmentShare(2015)).toBe(0);
  expect(batteryRebateCost(100000, 1, 2015, location)).toBe(0);
  expect(customerBatteryFleet(program, 61, 2015, 100000, location).powerW).toBe(
    0,
  );
  expect(batteryEnrollmentShare(2017)).toBeLessThan(0.1);
  expect(batteryEnrollmentShare(2100)).toBe(0.25);
});

test("readiness reflects the local market and stays bounded in distant future custom games", () => {
  expect(
    batteryEligibleHouseholdShare(2015, { country: "Germany" }),
  ).toBeGreaterThan(batteryEligibleHouseholdShare(2015, location));
  expect(batteryEligibleHouseholdShare(2025, location)).toBeGreaterThan(
    batteryEligibleHouseholdShare(2025, { country: "India" }),
  );
  expect(batteryEligibleHouseholdShare(3000, location)).toBeLessThanOrEqual(
    0.3,
  );
  expect(batteryEligibleHouseholdShare(2050, {})).toBe(
    batteryEligibleHouseholdShare(3000, {}),
  );
  const markets = [
    { country: "Japan" },
    { country: "Zambia" },
    { country: "South Africa" },
    { region: "Africa" },
    { region: "South Asia" },
  ];
  for (const market of markets) {
    expect(batteryEligibleHouseholdShare(2025, market)).toBeGreaterThan(0);
    expect(batteryEligibleHouseholdShare(2025, market)).toBeLessThanOrEqual(
      0.3,
    );
  }
  expect(residentialBatteryCostPerWh(3000)).toBe(
    residentialBatteryCostPerWh(2040),
  );
});

test("rebates price the actual installation cohort, cost nothing at zero rollout and scale with it", () => {
  expect(batteryRebateCost(10000, 0, 2025, location)).toBe(0);
  const whole = batteryRebateCost(10000, 1, 2025, location);
  expect(whole).toBeGreaterThan(0);
  expect(batteryRebateCost(10000, 0.25, 2025, location)).toBeCloseTo(whole / 4);
  expect(residentialBatteryCostPerWh(2015)).toBeGreaterThan(
    residentialBatteryCostPerWh(2025),
  );
  const funded = customerBatteryFleet(program, 1, 2025, 10000, location);
  expect(funded.installedHouseholds).toBe(
    batteryCohortHouseholds(10000, 1, 2025, location),
  );
  expect(funded.enrolledHouseholds).toBe(funded.installedHouseholds);
  expect(funded.powerW).toBe(funded.installedPowerW);
  expect(funded.capacityWh).toBe(funded.installedCapacityWh);
  expect(whole / funded.installedHouseholds).toBeCloseTo(
    CUSTOMER_BATTERIES.householdEnergyWh *
      residentialBatteryCostPerWh(2025) *
      CUSTOMER_BATTERIES.rebateShare,
  );
});

test.each([2016, 2017])(
  "a %i cohort does not acquire free hardware or VPP agreements as adoption rises",
  (startingYear) => {
    const installed = customerBatteryFleet(
      program,
      1,
      startingYear,
      10000,
      location,
    );
    const later = customerBatteryFleet(
      program,
      61,
      startingYear,
      10000,
      location,
    );
    const newInstallation = customerBatteryFleet(
      program,
      1,
      2020,
      10000,
      location,
    );
    expect(later.installedHouseholds).toBe(installed.installedHouseholds);
    expect(later.installedCapacityWh).toBeLessThan(
      installed.installedCapacityWh,
    );
    expect(newInstallation.installedHouseholds).toBeGreaterThan(
      later.installedHouseholds,
    );
    expect(installed.powerW).toBeGreaterThan(0);
    expect(later.powerW).toBe(installed.powerW);
    expect(later.enrolledHouseholds).toBe(installed.enrolledHouseholds);
    expect(batteryMonthlyCompensation(later)).toBe(
      batteryMonthlyCompensation(installed),
    );
    // Installation status is independent of the current dispatch contract.
    expect(
      customerBatteryFleet(
        { ...program, tier: "Off" },
        61,
        startingYear,
        10000,
        location,
      ),
    ).toEqual(later);
  },
);

test("future cohorts are excluded, energy fades with age and all hardware eventually retires", () => {
  expect(
    customerBatteryFleet(program, 0, 2025, 10000, location).capacityWh,
  ).toBe(0);
  const fresh = customerBatteryFleet(program, 1, 2025, 10000, location);
  const ten = customerBatteryFleet(program, 121, 2025, 10000, location);
  const retiring = customerBatteryFleet(program, 151, 2025, 10000, location);
  const fifteen = customerBatteryFleet(program, 181, 2025, 10000, location);
  expect(ten.installedHouseholds).toBe(fresh.installedHouseholds);
  expect(ten.installedCapacityWh).toBeCloseTo(fresh.installedCapacityWh * 0.7);
  expect(retiring.installedHouseholds).toBeCloseTo(
    fresh.installedHouseholds / 2,
  );
  expect(retiring.installedCapacityWh).toBeCloseTo(ten.installedCapacityWh / 2);
  expect(fifteen.installedHouseholds).toBe(0);
  expect(fifteen.powerW).toBe(0);
  expect(batteryMonthlyCompensation(fifteen)).toBe(0);
  expect(batteryMonthlyCompensation(fresh)).toBeGreaterThan(0);
});

test("new batteries start empty and cannot create energy or draw from the household reserve", () => {
  const empty = dispatchCustomerBattery(fleet, 0, {
    deficitW: 10000,
    peak: true,
  });
  expect(empty.dischargeW).toBe(0);
  expect(empty.storedWh).toBe(0);
  const reserve = dispatchCustomerBattery(fleet, 2000, {
    deficitW: 10000,
    peak: true,
  });
  expect(reserve.dischargeW).toBe(0);
  expect(reserve.storedWh).toBe(2000);
  const full = dispatchCustomerBattery(fleet, 10000, {
    deficitW: 10000,
    peak: true,
    stepMinutes: 120,
  });
  expect(full.dischargeW).toBe(4000);
  expect(full.storedWh).toBe(2000);
});

test("charge comes only from provided surplus, prioritizes rooftop recovery and books conversion losses", () => {
  const charged = dispatchCustomerBattery(fleet, 0, {
    rooftopSurplusW: 1000,
    gridSurplusW: 10000,
    stepMinutes: 60,
  });
  expect(charged.rooftopChargeW).toBe(1000);
  expect(charged.gridChargeW).toBe(4000);
  expect(charged.storedWh).toBe(4500);
  expect(charged.lossWh).toBeCloseTo(500);
  expect(charged.dischargeW).toBe(0);
  const discharged = dispatchCustomerBattery(fleet, charged.storedWh, {
    deficitW: 10000,
    peak: true,
    stepMinutes: 60,
  });
  expect(discharged.dischargeW).toBe(2500);
  expect(discharged.storedWh).toBe(2000);
  expect(charged.chargeW).toBeCloseTo(
    discharged.dischargeW + discharged.storedWh + charged.lossWh,
  );
});

test("near-full charging respects energy headroom and requires actual supplied power", () => {
  const charged = dispatchCustomerBattery(fleet, 9900, {
    rooftopSurplusW: 5000,
    gridSurplusW: 5000,
    stepMinutes: 60,
  });
  expect(charged.chargeW).toBeCloseTo(
    100 / CUSTOMER_BATTERIES.chargeEfficiency,
  );
  expect(charged.gridChargeW).toBe(0);
  expect(charged.storedWh).toBeCloseTo(10000);
  expect(dispatchCustomerBattery(fleet, 0).storedWh).toBe(0);
  const negative = dispatchCustomerBattery(fleet, 0, {
    rooftopSurplusW: -100,
    gridSurplusW: -100,
  });
  expect(negative.chargeW).toBe(0);
  expect(negative.storedWh).toBe(0);
});

test("Off suspends dispatch without destroying stored energy; retirement overflow is recorded as loss", () => {
  const disabled = dispatchCustomerBattery(fleet, 5000, {
    deficitW: 5000,
    rooftopSurplusW: 5000,
    gridSurplusW: 5000,
    peak: true,
    enabled: false,
  });
  expect(disabled).toEqual({
    storedWh: 5000,
    rooftopChargeW: 0,
    gridChargeW: 0,
    chargeW: 0,
    dischargeW: 0,
    lossWh: 0,
  });
  expect(
    dispatchCustomerBattery(fleet, 5000, {
      gridSurplusW: 1000,
      stepMinutes: 0,
    }),
  ).toEqual(disabled);
  const retired = dispatchCustomerBattery(
    { ...fleet, capacityWh: 0, powerW: 0 },
    5000,
  );
  expect(retired.storedWh).toBe(0);
  expect(retired.lossWh).toBe(5000);
});

test("peak dispatch never charges grid energy, and no tick can charge and discharge together", () => {
  const peak = dispatchCustomerBattery(fleet, 0, {
    rooftopSurplusW: 1000,
    gridSurplusW: 1000,
    peak: true,
  });
  expect(peak.rooftopChargeW).toBe(1000);
  expect(peak.gridChargeW).toBe(0);
  const deficit = dispatchCustomerBattery(fleet, 5000, {
    deficitW: 1000,
    rooftopSurplusW: 1000,
    gridSurplusW: 1000,
    peak: true,
  });
  expect(deficit.dischargeW).toBe(1000);
  expect(deficit.chargeW).toBe(0);
  expect(
    dispatchCustomerBattery(fleet, 5000, { deficitW: 1000 }).dischargeW,
  ).toBe(0);
});
