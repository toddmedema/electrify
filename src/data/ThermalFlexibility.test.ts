import {
  smartHeatingAvailability,
  thermalEquipmentProfile,
  waterControlAvailability,
} from "./ThermalFlexibility";
import type { LocationType } from "../Types";

const location = (country: string, admin?: string): LocationType => ({
  id: country,
  name: country,
  country,
  admin,
  lat: 0,
  long: 0,
});

test("legacy water relays exist in 1980 but connected heating rolls out much later", () => {
  expect(waterControlAvailability(1940)).toBe(0);
  expect(waterControlAvailability(1980)).toBe(1);
  expect(smartHeatingAvailability(1980)).toBe(0);
  expect(smartHeatingAvailability(2000)).toBe(0);
  expect(smartHeatingAvailability(2015)).toBeCloseTo(0.15);
  expect(smartHeatingAvailability(2025)).toBeGreaterThan(
    smartHeatingAvailability(2015),
  );
  expect(smartHeatingAvailability(2100)).toBeLessThan(1);
});

test("equipment prevalence distinguishes storage-heavy grids and fuel-heated homes", () => {
  const nz = thermalEquipmentProfile(location("New Zealand"));
  const uk = thermalEquipmentProfile(location("United Kingdom"));
  const quebec = thermalEquipmentProfile(location("Canada", "Québec"));
  const ontario = thermalEquipmentProfile(location("Canada", "ON"));
  expect(nz.hotWaterLoadShare).toBeGreaterThan(uk.hotWaterLoadShare);
  expect(quebec.electricHeatingShare).toBeGreaterThan(uk.electricHeatingShare);
  expect(quebec.electricHeatingShare).toBeGreaterThan(
    ontario.electricHeatingShare,
  );
  expect(
    thermalEquipmentProfile(location("Unknown")).hotWaterLoadShare,
  ).toBeLessThan(nz.hotWaterLoadShare);
});
