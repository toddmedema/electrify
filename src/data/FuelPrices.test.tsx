import { getFuelPricesPerMBTU, initFuelPricesFromCsv } from "./FuelPrices";
import { getDateFromMinute } from "../helpers/DateTime";
import { FuelPricesType } from "../Types";

const FIXTURE_STARTING_YEAR = 2000;
const FIXTURE_ENDING_YEAR = 2001;
const SEED = 1;

function fixtureCsv(): string {
  const rows = ["year,month,naturalgas,coal,uranium,oil"];
  for (let year = FIXTURE_STARTING_YEAR; year <= FIXTURE_ENDING_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      rows.push([year, month, 3, 2, 0.7, 10].join(","));
    }
  }
  return rows.join("\n");
}

// The game asks for prices by date, and a date is minutes since the start of the scenario
function dateIn(year: number, month: number) {
  const minute = ((year - FIXTURE_STARTING_YEAR) * 12 + (month - 1)) * 1440;
  return getDateFromMinute(minute, FIXTURE_STARTING_YEAR);
}

function pricesIn(year: number, month: number): FuelPricesType {
  return getFuelPricesPerMBTU(dateIn(year, month), SEED);
}

describe("getFuelPricesPerMBTU", () => {
  beforeEach(() => {
    initFuelPricesFromCsv(fixtureCsv());
  });

  it("returns the loaded prices for a year the data covers", () => {
    expect(pricesIn(FIXTURE_STARTING_YEAR, 6)).toEqual({
      "Natural Gas": 3,
      Coal: 2,
      Uranium: 0.7,
      Oil: 10,
    });
  });

  it("projects prices past the end of the data", () => {
    const projected = pricesIn(FIXTURE_ENDING_YEAR + 3, 6);
    Object.values(projected).forEach((price: number) => {
      expect(Number.isFinite(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    });
  });

  // The bug this replaced: a cold cache jumped straight from the last loaded year to the year
  // asked for, skipping the compounding in between, so a game loaded years past the data picked
  // up prices nowhere near the ones it was saved with
  it("projects the same prices cold as it does warm", () => {
    const target = FIXTURE_ENDING_YEAR + 20;
    for (let year = FIXTURE_ENDING_YEAR + 1; year <= target; year++) {
      pricesIn(year, 12); // Walk there a year at a time, the way a played game does
    }
    const walked = { ...pricesIn(target, 6) };

    initFuelPricesFromCsv(fixtureCsv()); // Back to a cache holding only the loaded data
    expect(pricesIn(target, 6)).toEqual(walked);
  });

  it("projects different prices for a different seed", () => {
    const first = { ...pricesIn(FIXTURE_ENDING_YEAR + 1, 6) };
    initFuelPricesFromCsv(fixtureCsv());
    const second = getFuelPricesPerMBTU(
      dateIn(FIXTURE_ENDING_YEAR + 1, 6),
      SEED + 1,
    );
    expect(second).not.toEqual(first);
  });

  it("explains itself rather than hanging when nothing has been loaded", () => {
    initFuelPricesFromCsv("year,month,naturalgas,coal,uranium,oil");
    expect(() => pricesIn(FIXTURE_STARTING_YEAR, 1)).toThrow(
      /No fuel prices loaded/,
    );
  });
});
