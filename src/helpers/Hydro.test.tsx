import { getDateFromMinute } from "./DateTime";
import {
  getHydroConditions,
  getMeanAnnualRunoffMm,
  hydroSizing,
  snowFraction,
} from "./Hydro";
import { initWeatherFromRows } from "../data/Weather";
import { RawWeatherType } from "../Types";

const YEARS = 4;
const HOURS = 24;

function rows(
  temperature: (month: number) => number,
  precipitationMmPerDay: (month: number) => number,
): RawWeatherType[] {
  const result: RawWeatherType[] = [];
  for (let year = 0; year < YEARS; year++) {
    for (let month = 1; month <= 12; month++) {
      for (let hour = 0; hour < HOURS; hour++) {
        result.push({
          YEAR: 1980 + year,
          MONTH: month,
          TEMP_C: temperature(month),
          CLOUD_PCT: 50,
          WIND_KPH: 10,
          // Basin records put the mean day's total in one hour. The monthly reducer sums the
          // sampled day before expanding it, so its position within the day is irrelevant.
          PRECIP_MM: hour === 0 ? precipitationMmPerDay(month) : 0,
        });
      }
    }
  }
  return result;
}

function date(year: number, month: number) {
  return getDateFromMinute(((year - 1980) * 12 + month - 1) * 1440, 1980);
}

describe("hydro watershed model", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it("splits precipitation smoothly between rain and snow", () => {
    expect(snowFraction(-1)).toBe(1);
    expect(snowFraction(1)).toBe(0.5);
    expect(snowFraction(3)).toBe(0);
  });

  it("accumulates a winter snowpack and melts it out in spring", () => {
    initWeatherFromRows(
      "basin",
      rows(
        (month) => ([12, 1, 2].includes(month) ? -2 : month === 3 ? 2 : 12),
        (month) => ([12, 1, 2].includes(month) ? 2 : 0),
      ),
    );
    const winter = getHydroConditions(date(1983, 2), 7, 0, "basin");
    const summer = getHydroConditions(date(1983, 7), 7, 0, "basin");
    expect(winter.snowpackMm).toBeGreaterThan(100);
    expect(winter.runoffMm).toBe(0);
    expect(summer.snowpackMm).toBe(0);
  });

  it("warms the same basin into a smaller snowpack", () => {
    initWeatherFromRows(
      "basin",
      rows(
        (month) => ([12, 1, 2].includes(month) ? -2 : 10),
        (month) => ([12, 1, 2].includes(month) ? 2 : 0),
      ),
    );
    const clean = getHydroConditions(date(1983, 2), 9, 0, "basin");
    const dirty = getHydroConditions(date(1983, 2), 9, 200, "basin");
    expect(dirty.snowpackMm).toBeLessThan(clean.snowpackMm);
    expect(dirty.meltMm).toBeGreaterThan(clean.meltMm);
  });

  it("keeps tropical precipitation as rain and never invents snow", () => {
    initWeatherFromRows(
      "tropical",
      rows(
        () => 25,
        () => 3,
      ),
    );
    const wet = getHydroConditions(date(1983, 6), 1, 0, "tropical");
    expect(wet.precipitationMm).toBeGreaterThan(0);
    expect(wet.rainMm).toBeCloseTo(wet.precipitationMm);
    expect(wet.snowpackMm).toBe(0);
  });

  it("keeps a city's weather and its upstream watershed loaded side by side", () => {
    initWeatherFromRows(
      "city",
      rows(
        () => 20,
        () => 0,
      ),
    );
    initWeatherFromRows(
      "basin",
      rows(
        () => 10,
        () => 2,
      ),
      true,
    );
    expect(getHydroConditions(date(1983, 6), 1, 0, "city").runoffMm).toBe(0);
    expect(
      getHydroConditions(date(1983, 6), 1, 0, "basin").runoffMm,
    ).toBeGreaterThan(0);
  });

  it("calibrates finite reservoir energy from the basin climatology", () => {
    initWeatherFromRows(
      "basin",
      rows(
        () => 12,
        () => 2,
      ),
    );
    expect(getMeanAnnualRunoffMm("basin")).toBeGreaterThan(0);
    expect(hydroSizing(100_000_000, "basin")).toEqual(
      expect.objectContaining({
        reservoirCapacityWh: 100_000_000_000,
        hydroWhPerMm: expect.any(Number),
        hydroMeanMonthlyInflowWh: expect.any(Number),
      }),
    );
  });
});
