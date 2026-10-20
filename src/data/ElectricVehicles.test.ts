import type { LocationType } from "../Types";
import {
  electricVehicleEligibility,
  managedChargingAnnualCost,
  managedChargingParticipants,
} from "./ElectricVehicles";

const location = (country: string, region?: string): LocationType => ({
  id: country,
  name: country,
  country,
  region,
  lat: 0,
  long: 0,
});

test.each([1980, 1990, 2000, 2009, 2010])(
  "has no modern flexible EV fleet in %i, even in an early-adoption country",
  (year) => {
    expect(electricVehicleEligibility(year, location("Norway"))).toEqual({
      fleetShare: 0,
      smartChargingShare: 0,
      eligibleTransportationShare: 0,
    });
    expect(managedChargingAnnualCost(10000, year, location("Norway"))).toBe(0);
  },
);

test("2015 eligibility uses small installed fleets, not new-car sales", () => {
  for (const country of ["United States", "China", "France", "Australia"]) {
    const early = electricVehicleEligibility(2015, location(country));
    const current = electricVehicleEligibility(2025, location(country));
    expect(early.fleetShare).toBeGreaterThan(0);
    expect(early.fleetShare).toBeLessThan(0.005);
    expect(early.smartChargingShare).toBeLessThan(current.smartChargingShare);
    expect(
      managedChargingParticipants(10000, 2015, location(country)),
    ).toBeLessThan(
      managedChargingParticipants(10000, 2025, location(country)) / 10,
    );
  }
});

test("distinguishes international fleet stocks and uses country before regional fallback", () => {
  const norway = electricVehicleEligibility(2024, location("Norway", "Europe"));
  const china = electricVehicleEligibility(
    2024,
    location("China", "East Asia"),
  );
  const europe = electricVehicleEligibility(
    2024,
    location("Germany", "Europe"),
  );
  const africa = electricVehicleEligibility(2024, location("Zambia", "Africa"));
  expect(norway.fleetShare).toBeGreaterThan(china.fleetShare);
  expect(china.fleetShare).toBeGreaterThan(europe.fleetShare);
  expect(europe.fleetShare).toBeGreaterThan(africa.fleetShare);
  expect(electricVehicleEligibility(2024, location("CN")).fleetShare).toBe(
    china.fleetShare,
  );
  expect(electricVehicleEligibility(2024).fleetShare).toBeCloseTo(0.04);
});

test("interpolates fleet turnover and clamps distant-future adoption", () => {
  const before = electricVehicleEligibility(2020).fleetShare;
  const after = electricVehicleEligibility(2024).fleetShare;
  expect(electricVehicleEligibility(2022).fleetShare).toBeCloseTo(
    (before + after) / 2,
  );
  for (const country of [
    "Norway",
    "China",
    "United States",
    "Australia",
    "Zambia",
  ]) {
    const last = electricVehicleEligibility(2070, location(country));
    expect(electricVehicleEligibility(2500, location(country))).toEqual(last);
    expect(last.fleetShare).toBeLessThan(1);
    expect(last.eligibleTransportationShare).toBeLessThan(0.75);
  }
  expect(electricVehicleEligibility(Number.NaN).fleetShare).toBe(0);
});

test("ongoing participation costs scale with actual enrollment and eligible equipment", () => {
  const city = location("China");
  const full = managedChargingAnnualCost(10000, 2025, city, 0.5);
  expect(full).toBeGreaterThan(0);
  expect(managedChargingAnnualCost(10000, 2025, city, 0.25)).toBeCloseTo(
    full / 2,
  );
  expect(managedChargingAnnualCost(10000, 2025, city, 0)).toBe(0);
  expect(managedChargingAnnualCost(0, 2025, city)).toBe(0);
  expect(managedChargingAnnualCost(10000, 2025, city, 2)).toBe(full);
  expect(managedChargingAnnualCost(10000, 2025, city, -1)).toBe(0);
});

test("only pays for vehicles represented in the game's existing electric transport demand", () => {
  const city = location("United States");
  const stockCost = managedChargingAnnualCost(10000, 2025, city, 0.5);
  expect(managedChargingAnnualCost(10000, 2025, city, 0.5, 0)).toBe(0);
  const limited = managedChargingAnnualCost(10000, 2025, city, 0.5, 1000);
  expect(limited).toBeGreaterThan(0);
  expect(limited).toBeLessThan(stockCost / 10);
  expect(managedChargingAnnualCost(10000, 2025, city, 0.5, 2000)).toBeCloseTo(
    limited * 2,
  );
  expect(managedChargingAnnualCost(10000, 2025, city, 0.5, 1e9)).toBe(
    stockCost,
  );
});
