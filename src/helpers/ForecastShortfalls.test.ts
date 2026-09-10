import { GAME_TO_REAL_YEARS } from "../Constants";
import { forecastShortfalls } from "./ForecastShortfalls";

describe("representative-day shortfall estimates", () => {
  it("preserves energy when the forecast sample interval changes", () => {
    const hourly = forecastShortfalls(
      [{ minute: 0, demandW: 100, supplyW: 60 }],
      60,
      100,
    );
    const quarterHourly = forecastShortfalls(
      [0, 15, 30, 45].map((minute) => ({ minute, demandW: 100, supplyW: 60 })),
      15,
      100,
    );
    expect(hourly.blackoutTotalWh).toBeCloseTo(40 * GAME_TO_REAL_YEARS);
    expect(quarterHourly.blackoutTotalWh).toBeCloseTo(hourly.blackoutTotalWh);
    expect(quarterHourly.largestBlackout).toEqual(hourly.largestBlackout);
  });

  it("closes an outage when supply exactly meets demand and separates later shortages", () => {
    const result = forecastShortfalls(
      [
        { minute: 0, demandW: 100, supplyW: 60 },
        { minute: 15, demandW: 100, supplyW: 100 },
        { minute: 30, demandW: 100, supplyW: 90 },
      ],
      15,
      100,
    );
    expect(result.largestBlackout).toMatchObject({
      start: 0,
      end: 15,
      peakW: 40,
    });
    expect(result.blackouts).toContainEqual({ minute: 15, value: 0 });
    expect(result.blackoutTotalWh).toBeCloseTo(12.5 * GAME_TO_REAL_YEARS);
  });

  it("reports no outage for adequate or empty forecasts", () => {
    expect(forecastShortfalls([], 15, 100).blackoutTotalWh).toBe(0);
    expect(
      forecastShortfalls([{ minute: 0, demandW: 100, supplyW: 150 }], 15, 150)
        .blackouts,
    ).toEqual([]);
  });
});
