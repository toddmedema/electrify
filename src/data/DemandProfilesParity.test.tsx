import { getDateFromMinute } from "../helpers/DateTime";
import { pow } from "../helpers/Pow";
import { DemandByTypeType } from "../Types";
import { DEMAND_TYPES, demandByTypeAt } from "./DemandProfiles";

// The 1990 opening has neither data centers nor elapsed growth. That isolates the daily
// shapes and their normalization through the public API, including all lookup slots and the
// arbitrary-minute fallback. Keep this direct formula independent of the optimized lookup.
it("preserves exact sector shapes at every quarter-hour and off-grid minute", () => {
  const minutes = [
    ...Array.from({ length: 96 }, (_, i) => i * 15),
    -15,
    -0.125,
    0.125,
    1,
    14.999,
    15.001,
    1439.999,
    1440,
  ];
  minutes.forEach((minuteOfDay) => {
    const hour = minuteOfDay / 60;
    const peak = (at: number, width: number) =>
      Math.exp(-pow(hour - at, 2) / (2 * width * width));
    const shape: DemandByTypeType = {
      Residential: 0.65 + 0.45 * peak(7, 1.8) + 0.75 * peak(19, 2.5),
      Commercial: 0.35 + 0.9 * peak(13, 4.5),
      Industrial: 1,
      Transportation: 0.55 + 0.8 * peak(1, 3) + 0.55 * peak(21, 2.5),
      Mining: 1,
      "Data Centers": 1,
    };
    const weight: DemandByTypeType = {
      Residential: 0.39,
      Commercial: 0.34,
      Industrial: 0.265,
      Transportation: 0.005,
      Mining: 0,
      "Data Centers": 0,
    };
    const shapedTotal = DEMAND_TYPES.reduce(
      (sum, type) => sum + weight[type] * shape[type],
      0,
    );
    const baseline = 1_234_567.89;
    const expected = {} as DemandByTypeType;
    DEMAND_TYPES.forEach((type) => {
      expected[type] = (baseline * weight[type] * shape[type]) / shapedTotal;
    });
    expected["Data Centers"] +=
      baseline - DEMAND_TYPES.reduce((sum, type) => sum + expected[type], 0);
    const actual = demandByTypeAt(
      baseline,
      { ...getDateFromMinute(0, 1990), minuteOfDay },
      1990,
    );
    expect({ minuteOfDay, actual }).toEqual({ minuteOfDay, actual: expected });
  });
});
