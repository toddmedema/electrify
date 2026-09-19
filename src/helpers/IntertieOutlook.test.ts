import { DIFFICULTIES } from "../Constants";
import {
  adjacentMarketForCorridor,
  TRANSMISSION_CORRIDORS,
} from "../data/AdjacentMarkets";
import { MINUTES_PER_MONTH } from "./DateTime";
import { intertieOutlook, pricePeriodCaption } from "./IntertieOutlook";
import { IntertieContext, intertieImportLimitW } from "./Transmission";

const intern: IntertieContext = {
  seed: 42,
  southernHemisphere: false,
  peakSharingImportLoss: DIFFICULTIES.Intern.peakSharingImportLoss,
};
const ceo: IntertieContext = {
  ...intern,
  peakSharingImportLoss: DIFFICULTIES.CEO.peakSharingImportLoss,
};

/** Hourly ticks for a year; demand and heat both peak at 6pm */
function year(options: { peakTemperatureC?: number; months?: number } = {}) {
  const { peakTemperatureC = 20, months = 12 } = options;
  const ticks = [];
  for (let month = 0; month < months; month++) {
    for (let hour = 0; hour < 24; hour++) {
      const peak = hour === 18;
      ticks.push({
        minute: month * MINUTES_PER_MONTH + hour * 60,
        demandW: peak ? 2e9 : 1e9,
        temperatureC: peak ? peakTemperatureC : 20,
        solarIrradianceWM2: hour >= 8 && hour < 17 ? 600 : 0,
      });
    }
  }
  return ticks;
}

function corridorWithArchetype(archetype: string) {
  return TRANSMISSION_CORRIDORS.find(
    ({ id }) => adjacentMarketForCorridor(id)?.archetype === archetype,
  )!;
}

describe("intertie outlook", () => {
  it("waits for a forecast covering every calendar month", () => {
    expect(
      intertieOutlook("california-south", intern, year({ months: 11 })),
    ).toBeUndefined();
    expect(intertieOutlook("nowhere", intern, year())).toBeUndefined();
  });

  it("describes a solar neighbour as cheap at midday and dear in the evening", () => {
    const outlook = intertieOutlook("california-south", intern, year())!;
    expect(outlook.archetype.id).toBe("SOLAR_HEAVY");
    expect(outlook.monthly).toHaveLength(12);
    expect(outlook.cheapestPeriod).toBe("midday");
    expect(outlook.priciestPeriod).toBe("evening");
    expect(pricePeriodCaption(outlook)).toBe(
      "Cheapest midday · priciest evening",
    );
    expect(outlook.priceLow).toBeLessThanOrEqual(outlook.priceMedian);
    expect(outlook.priceMedian).toBeLessThanOrEqual(outlook.priceHigh);
    // Evening is when the neighbour has least to spare, and demand peaks at 6pm here
    expect(outlook.atPeak).toBeLessThan(outlook.mean);
    outlook.monthly.forEach((share) => {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThanOrEqual(1);
    });
  });

  it("shows a seasonal hydro neighbour tightening in late summer and fall", () => {
    const outlook = intertieOutlook("california-north", intern, year())!;
    expect(outlook.archetype.id).toBe("SEASONAL_HYDRO");
    expect([7, 8, 9]).toContain(outlook.lowMonth);
    expect(outlook.monthly[5]).toBeGreaterThan(
      outlook.monthly[outlook.lowMonth],
    );
  });

  it("averages exactly what the simulation would let each tick import", () => {
    const ticks = year();
    const line = { corridorId: "california-south", capacityW: 750_000_000 };
    const january = ticks.filter((tick) => tick.minute < MINUTES_PER_MONTH);
    const expected =
      january.reduce(
        (sum, tick) =>
          sum + intertieImportLimitW(line, intern, tick.minute, tick),
        0,
      ) /
      january.length /
      line.capacityW;
    expect(expected).toBeGreaterThan(0);
    expect(
      intertieOutlook("california-south", intern, ticks)!.monthly[0],
    ).toBeCloseTo(expected, 10);
  });

  it("ignores ticks before the current minute", () => {
    const ticks = year();
    const later = intertieOutlook(
      "california-south",
      intern,
      [
        ...ticks,
        ...year().map((t) => ({
          ...t,
          minute: t.minute + 12 * MINUTES_PER_MONTH,
        })),
      ],
      12 * MINUTES_PER_MONTH,
    );
    expect(later?.monthly).toHaveLength(12);
  });

  it("lets a peak-sharing neighbour help less at hot peaks on harder difficulties", () => {
    const corridor = corridorWithArchetype("PEAK_SHARING");
    expect(corridor).toBeDefined();
    const hot = year({ peakTemperatureC: 40 });
    const easy = intertieOutlook(corridor.id, intern, hot)!;
    const hard = intertieOutlook(corridor.id, ceo, hot)!;
    expect(hard.atPeak).toBeLessThan(easy.atPeak);
    expect(easy.atPeak).toBeLessThan(easy.mean);
    // Away from the peak nothing differs between difficulties
    const mild = year();
    expect(intertieOutlook(corridor.id, ceo, mild)!.atPeak).toBeCloseTo(
      intertieOutlook(corridor.id, intern, mild)!.atPeak,
      10,
    );
  });
});
