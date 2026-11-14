import * as fs from "fs";
import * as path from "path";
import { SCENARIOS } from "../data/Scenarios";
import { CURRENCIES, COUNTRY_CURRENCY_CODES } from "../data/Currencies";
import type { LocationType } from "../Types";
import { getScenarioLocation } from "./Locations";
import {
  USD_CURRENCY,
  currencyByCode,
  currencyForLocation,
  isCurrencyCode,
} from "./Currency";

const location = (country?: string): LocationType => ({
  id: "test",
  name: "Test",
  lat: 0,
  long: 0,
  country,
});

describe("local currency resolution", () => {
  it("explicitly covers every playable catalogue country", () => {
    const index = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../public/data/weather/index.json"),
        "utf8",
      ),
    ) as { cities: Record<string, LocationType> };
    const countries = [
      ...new Set(Object.values(index.cities).map((city) => city.country)),
    ];
    expect(countries.length).toBeGreaterThan(100);
    countries.forEach((country) => {
      expect(country).toBeDefined();
      expect(COUNTRY_CURRENCY_CODES).toHaveProperty(country!);
      expect(currencyForLocation(location(country)).code).toBe(
        COUNTRY_CURRENCY_CODES[country!],
      );
    });
  });

  it("resolves every official scenario from its actual location", () => {
    SCENARIOS.forEach((scenario) => {
      const place = getScenarioLocation(scenario);
      expect(place?.country).toBeDefined();
      expect(COUNTRY_CURRENCY_CODES).toHaveProperty(place!.country!);
      const currency = currencyForLocation(place, scenario.startingYear);
      expect(isCurrencyCode(currency.code)).toBe(true);
      expect(currency.code === "USD").toBe(place?.country === "United States");
    });
  });

  it.each([
    ["France", "EUR"],
    ["India", "INR"],
    ["Zambia", "ZMW"],
    ["South Africa", "ZAR"],
    ["Japan", "JPY"],
    ["Bulgaria", "EUR"],
    ["Syria", "SYP"],
    ["Panama", "PAB"],
  ])("uses %s's local denomination %s", (country, code) => {
    expect(currencyForLocation(location(country)).code).toBe(code);
  });

  it("keeps the Soviet ruble fixed across a Chernobyl run", () => {
    expect(currencyForLocation(location("Ukraine"), 1986).code).toBe("SUR");
    expect(currencyForLocation(location("Ukraine"), 1991).code).toBe("SUR");
    expect(currencyForLocation(location("Ukraine"), 1992).code).toBe("UAH");
    expect(currencyForLocation(location("Ukraine")).code).toBe("UAH");
    expect(currencyForLocation(location("France"), 1986).code).toBe("EUR");
  });

  it("falls back to USD for unknown or metadata-free custom locations", () => {
    expect(currencyForLocation()).toBe(USD_CURRENCY);
    expect(currencyForLocation(location())).toBe(USD_CURRENCY);
    expect(currencyForLocation(location("Unknown"))).toBe(USD_CURRENCY);
    expect(currencyForLocation(location("toString"))).toBe(USD_CURRENCY);
  });

  it("allowlists saved codes and keeps every display rate finite and positive", () => {
    Object.values(CURRENCIES).forEach((currency) => {
      expect(currencyByCode(currency.code)).toBe(currency);
      expect(isCurrencyCode(currency.code)).toBe(true);
      expect(currency.symbol.length).toBeGreaterThan(0);
      expect(Number.isFinite(currency.unitsPerDollar)).toBe(true);
      expect(currency.unitsPerDollar).toBeGreaterThan(0);
    });
    [undefined, "unknown", "constructor", "__proto__"].forEach((code) => {
      expect(isCurrencyCode(code)).toBe(false);
      expect(currencyByCode(code)).toBe(USD_CURRENCY);
    });
    expect(isCurrencyCode({ code: "EUR" })).toBe(false);
  });
});
