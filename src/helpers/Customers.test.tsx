import {
  CUSTOMER_RATE_MEMORY_MONTHS,
  getMarketRate,
  customerMarketSizeAt,
  customerSwitchingRate,
  nextCustomerCount,
  projectCustomerChange,
  updateCustomerRate,
} from "./Customers";
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from "../Constants";
import { initEconomyFromCsv } from "../data/Economy";

describe("customer price competition", () => {
  it("preserves a small utility's growth across a whole year", () => {
    let customers = 100;
    for (let tick = 0; tick < TICKS_PER_YEAR; tick++) {
      customers = nextCustomerCount({
        customers,
        customerRate: 0.1,
        marketRate: 0.1,
        marketSize: 200,
        ownership: "Public",
      });
    }
    expect(customers).toBeCloseTo(100 * Math.exp(0.015), 2);
  });

  it("compounds the market benchmark with inflation every year", () => {
    initEconomyFromCsv(
      "month,year,prime,inflation\n" +
        [2020, 2021, 2022]
          .flatMap((year) =>
            Array.from(
              { length: 12 },
              (_, month) => `${month + 1},${year},4,0.12`,
            ),
          )
          .join("\n"),
    );
    for (let year = 2020; year <= 2022; year++) {
      expect(getMarketRate(0.1, { year, monthNumber: 1 }, 2020, 1)).toBeCloseTo(
        0.1 * Math.pow(1.01, (year - 2020) * 12),
        10,
      );
    }
  });
  it("gains customers below market, holds share at market, and loses above it", () => {
    const base = {
      customers: 1_000_000,
      marketSize: 2_000_000,
      marketRate: 0.1,
      ownership: "Investor" as const,
      organicGrowthRate: 0,
    };
    expect(nextCustomerCount({ ...base, customerRate: 0.09 })).toBeGreaterThan(
      base.customers,
    );
    expect(nextCustomerCount({ ...base, customerRate: 0.1 })).toBe(
      base.customers,
    );
    expect(nextCustomerCount({ ...base, customerRate: 0.11 })).toBeLessThan(
      base.customers,
    );
  });

  it("does not let an investor exceed the addressable market", () => {
    expect(
      nextCustomerCount({
        customers: 1_999_999,
        customerRate: 0,
        marketRate: 0.1,
        marketSize: 2_000_000,
        ownership: "Investor",
      }),
    ).toBeLessThanOrEqual(2_000_000);
  });

  it("keeps public customers insensitive to the electricity rate", () => {
    const cheap = nextCustomerCount({
      customers: 1_000_000,
      customerRate: 0,
      marketRate: 0.1,
      marketSize: 2_000_000,
      ownership: "Public",
      organicGrowthRate: 0,
    });
    const expensive = nextCustomerCount({
      customers: 1_000_000,
      customerRate: 1,
      marketRate: 0.1,
      marketSize: 2_000_000,
      ownership: "Public",
      organicGrowthRate: 0,
    });
    expect(cheap).toBe(1_000_000);
    expect(expensive).toBe(cheap);
  });

  it("caps extreme price responses and never returns a negative count", () => {
    expect(customerSwitchingRate(0, 0.1)).toBe(0.3);
    expect(customerSwitchingRate(1, 0.1)).toBe(-0.3);
    expect(
      nextCustomerCount({
        customers: 1,
        customerRate: 1,
        marketRate: 0.1,
        marketSize: 2,
        ownership: "Investor",
        organicGrowthRate: -2000,
      }),
    ).toBe(0);
  });

  it("smooths a new bill over roughly three months", () => {
    let perceived = 0.1;
    for (let i = 0; i < CUSTOMER_RATE_MEMORY_MONTHS * TICKS_PER_MONTH; i++) {
      perceived = updateCustomerRate(perceived, 0.05);
    }
    expect(perceived).toBeGreaterThan(0.05);
    expect(perceived).toBeCloseTo(0.0683, 3);
  });

  it("preserves bill-memory decay when an hourly forecast advances four ticks", () => {
    let quarterHourly = 0.1;
    for (let i = 0; i < 4; i++) {
      quarterHourly = updateCustomerRate(quarterHourly, 0.05);
    }

    expect(updateCustomerRate(0.1, 0.05, 4)).toBeCloseTo(quarterHourly, 12);
  });

  it("projects the same gradual response used by the tick model", () => {
    const common = {
      customers: 1_000_000,
      customerRate: 0.1,
      marketRateAt: () => 0.1,
      marketSizeAt: () => 2_000_000,
      ownership: "Investor" as const,
    };
    expect(
      projectCustomerChange({ ...common, currentRate: 0.08 }),
    ).toBeGreaterThan(0);
    expect(
      projectCustomerChange({ ...common, currentRate: 0.12 }),
    ).toBeLessThan(0);
  });

  it("grows the serviceable market with the population", () => {
    expect(customerMarketSizeAt(2_000_000, 0)).toBe(2_000_000);
    expect(
      customerMarketSizeAt(2_000_000, 12 * TICKS_PER_MONTH * 15),
    ).toBeGreaterThan(2_000_000);
  });
});
