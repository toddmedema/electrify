import { TickPresentFutureType } from "../../Types";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { supplyDemandMonthlyRanges } from "./ChartSupplyDemandRanges";

const tick = (minute: number, supplyW: number, demandW: number) =>
  ({ minute, supplyW, demandW }) as TickPresentFutureType;

it("keeps brief extrema and actual coincident shortfalls in each forecast month", () => {
  const ranges = supplyDemandMonthlyRanges(
    [
      tick(0, 120, 100),
      tick(60, 30, 80),
      tick(120, 200, 220),
      tick(MINUTES_PER_MONTH, 100, 100),
    ],
    0,
  );
  expect(ranges).toEqual([
    {
      minute: 0,
      projected: true,
      supplyMin: 30,
      supplyMax: 200,
      demandMin: 80,
      demandMax: 220,
      peakShortfall: 50,
    },
    {
      minute: MINUTES_PER_MONTH,
      projected: true,
      supplyMin: 100,
      supplyMax: 100,
      demandMin: 100,
      demandMax: 100,
      peakShortfall: 0,
    },
  ]);
});

it("keeps a recorded monthly average separate from that month's forecast", () => {
  const ranges = supplyDemandMonthlyRanges(
    [tick(0, 100, 90), tick(60, 70, 80), tick(120, 150, 100)],
    60,
  );
  expect(ranges).toHaveLength(2);
  expect(ranges[0]).toMatchObject({
    projected: false,
    supplyMin: 100,
    supplyMax: 100,
  });
  expect(ranges[1]).toMatchObject({
    projected: true,
    supplyMin: 70,
    supplyMax: 150,
    peakShortfall: 10,
  });
});

it("does not infer a shortage from noncoincident supply and demand extrema", () => {
  expect(
    supplyDemandMonthlyRanges([tick(0, 60, 50), tick(60, 200, 180)], 0)[0]
      .peakShortfall,
  ).toBe(0);
  expect(supplyDemandMonthlyRanges([], 0)).toEqual([]);
});
