import {
  DEFAULT_BUILD_SIZE,
  mostRecentBuiltSize,
  sliderTickToW,
  wToSliderTick,
} from "./BuildSizing";
import { FacilityOperatingType } from "../Types";

describe("size slider", () => {
  it("steps the leading digit and then the magnitude", () => {
    expect(sliderTickToW(0)).toBe(1e6);
    expect(sliderTickToW(8)).toBe(9e6);
    expect(sliderTickToW(9)).toBe(10e6);
    expect(sliderTickToW(10)).toBe(20e6);
  });

  it("round-trips every tick", () => {
    for (let tick = 0; tick <= 37; tick++) {
      expect(wToSliderTick(sliderTickToW(tick))).toBe(tick);
    }
  });

  it("rounds an exact size down to its tick", () => {
    expect(wToSliderTick(450e6)).toBe(wToSliderTick(400e6));
  });
});

describe("mostRecentBuiltSize", () => {
  const facility = (
    id: number,
    peakW: number,
    peakWh?: number,
  ): FacilityOperatingType =>
    ({ id, peakW, peakWh }) as unknown as FacilityOperatingType;

  it("takes the newest facility of the requested kind", () => {
    const fleet = [
      facility(1, 100e6),
      facility(3, 50e6, 200e6),
      facility(2, 300e6),
      facility(4, 20e6, 80e6),
    ];
    expect(mostRecentBuiltSize(fleet, false)).toBe(300e6);
    expect(mostRecentBuiltSize(fleet, true)).toBe(80e6);
  });

  it("opens at the default size when nothing of that kind exists", () => {
    expect(mostRecentBuiltSize([facility(1, 100e6)], true)).toBe(
      DEFAULT_BUILD_SIZE,
    );
    expect(mostRecentBuiltSize([], false)).toBe(DEFAULT_BUILD_SIZE);
  });
});
