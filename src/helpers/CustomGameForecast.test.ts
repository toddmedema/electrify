import { TickPresentFutureType } from "../Types";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { loadSimData } from "../testing/SimData";
import { getScenarioLocation } from "./Locations";
import {
  forecastCustomGameYearOne,
  summarizeYearOneOutlook,
} from "./CustomGameForecast";

function tick(demandW: number, supplyW: number): TickPresentFutureType {
  return { demandW, supplyW } as TickPresentFutureType;
}

describe("summarizeYearOneOutlook", () => {
  it("reports surplus annual generation with no shortfall", () => {
    expect(summarizeYearOneOutlook([tick(100, 300), tick(200, 600)])).toEqual({
      demandServed: 3,
      worstShortfallW: 0,
    });
  });

  it("combines annual coverage with the worst instantaneous deficit", () => {
    expect(
      summarizeYearOneOutlook([tick(100, 80), tick(200, 150), tick(100, 120)]),
    ).toEqual({ demandServed: 0.875, worstShortfallW: 50 });
  });

  it("keeps an instantaneous shortfall even with an annual surplus", () => {
    expect(summarizeYearOneOutlook([tick(100, 50), tick(100, 550)])).toEqual({
      demandServed: 3,
      worstShortfallW: 50,
    });
  });

  it("handles an empty forecast without inventing a shortfall", () => {
    expect(summarizeYearOneOutlook([])).toEqual({
      demandServed: 1,
      worstShortfallW: 0,
    });
  });

  it("treats sub-watt forecast noise as covered", () => {
    expect(summarizeYearOneOutlook([tick(100, 99.5)])).toEqual({
      demandServed: 0.995,
      worstShortfallW: 0,
    });
  });
});

describe("forecastCustomGameYearOne", () => {
  it("uses the production forecast so dependable generation improves an empty fleet", () => {
    loadSimData(getScenarioLocation(DEFAULT_CUSTOM_SCENARIO)!);
    const empty = forecastCustomGameYearOne(
      { ...DEFAULT_CUSTOM_SCENARIO, facilities: [] },
      "Intern",
      1234,
    );
    const supplied = forecastCustomGameYearOne(
      {
        ...DEFAULT_CUSTOM_SCENARIO,
        facilities: [{ name: "Natural Gas", peakW: 2_000_000_000 }],
      },
      "Intern",
      1234,
    );

    expect(empty.demandServed).toBe(0);
    expect(empty.worstShortfallW).toBeGreaterThan(0);
    expect(supplied.demandServed).toBeGreaterThan(3);
    expect(supplied.worstShortfallW).toBeLessThan(empty.worstShortfallW);
  });
});
