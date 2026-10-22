import {
  CALIFORNIA_WILDFIRE_ACCOUNT_HOURS,
  CALIFORNIA_WILDFIRE_BACKUP_KGCO2E_PER_MWH,
  CALIFORNIA_WILDFIRE_BACKUP_WH,
  CALIFORNIA_WILDFIRE_ISOLATED_ACCOUNTS,
  CALIFORNIA_WILDFIRE_REPAIR_COST,
  CALIFORNIA_WILDFIRE_REPAIR_COST_PER_MONTH,
  CALIFORNIA_WILDFIRE_SERVICE_INTERRUPTION_FRACTION,
} from "./CaliforniaWildfire";

test("bounds the account-hour estimate to the observed January 14–28 fire reports", () => {
  expect(CALIFORNIA_WILDFIRE_ISOLATED_ACCOUNTS[0]).toEqual({
    day: 14,
    accounts: 17_962,
  });
  expect(CALIFORNIA_WILDFIRE_ISOLATED_ACCOUNTS.at(-1)).toEqual({
    day: 28,
    accounts: 8_410,
  });
  expect(CALIFORNIA_WILDFIRE_ACCOUNT_HOURS).toBe(3_613_704);
  // A partial-month service estimate must not turn into the peak account share for all 730h.
  expect(CALIFORNIA_WILDFIRE_SERVICE_INTERRUPTION_FRACTION).toBeGreaterThan(0);
  expect(CALIFORNIA_WILDFIRE_SERVICE_INTERRUPTION_FRACTION).toBeLessThan(
    8_410 / 1_600_000,
  );
});

test("keeps a finite mobile-generator fuel allowance and the documented repair envelope", () => {
  expect(CALIFORNIA_WILDFIRE_BACKUP_WH).toBe(3_600_000);
  expect(CALIFORNIA_WILDFIRE_REPAIR_COST).toBe(780_000);
  expect(CALIFORNIA_WILDFIRE_REPAIR_COST_PER_MONTH * 3).toBe(
    CALIFORNIA_WILDFIRE_REPAIR_COST,
  );
});

test("counts the reserved diesel's combustion emissions rather than treating backup as carbon-free", () => {
  expect(CALIFORNIA_WILDFIRE_BACKUP_KGCO2E_PER_MWH).toBeCloseTo(639.5984622, 6);
  expect(
    (CALIFORNIA_WILDFIRE_BACKUP_WH / 1e6) *
      CALIFORNIA_WILDFIRE_BACKUP_KGCO2E_PER_MWH,
  ).toBeCloseTo(2302.554464, 6);
});
