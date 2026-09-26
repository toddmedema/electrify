import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { TickPresentFutureType } from "../../Types";
import { monthlyAverages } from "./ChartForecastSupplyByFuel";

function tick(
  minute: number,
  coal: number,
  demandW: number,
): TickPresentFutureType {
  return {
    minute,
    demandW,
    supplyByFuel: { Coal: coal },
  } as TickPresentFutureType;
}

describe("monthlyAverages", () => {
  it("collapses a zoomed-out stack to one time-weighted point per month", () => {
    const month = MINUTES_PER_MONTH;
    const months = monthlyAverages(
      [
        // A recorded month, already an average
        tick(0, 100, 90),
        // The forecast: uneven samples, the second covering three times the first
        tick(month + month / 4, 0, 0),
        tick(month + month / 2, 40, 80),
        tick(2 * month, 10, 20),
        tick(3 * month - 1, 10, 20),
      ],
      ["Coal"],
    );
    expect(months.map((m) => m.minute)).toEqual([
      0,
      month + month / 4,
      2 * month,
    ]);
    expect(months[0].supplyByFuel.Coal).toBeCloseTo(100);
    expect(months[0].demandW).toBeCloseTo(90);
    // A quarter-month at 0, then half a month at 40 (to the month's end, not the next sample)
    expect(months[1].supplyByFuel.Coal).toBeCloseTo((0 * 1 + 40 * 2) / 3);
    expect(months[1].demandW).toBeCloseTo((0 * 1 + 80 * 2) / 3);
    expect(months[2].supplyByFuel.Coal).toBeCloseTo(10);
  });

  it("treats a missing fuel as zero rather than dropping the month", () => {
    const months = monthlyAverages(
      [
        tick(0, 50, 50),
        { minute: 10, demandW: 50, supplyByFuel: {} } as TickPresentFutureType,
        tick(20, 50, 50),
      ],
      ["Coal"],
    );
    expect(months).toHaveLength(1);
    expect(months[0].supplyByFuel.Coal).toBeCloseTo(25);
  });
});
