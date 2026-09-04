import {
  clampChartViewport,
  eventChartViewport,
  panChartViewport,
  zoomChartViewport,
} from "./ChartViewportContext";

describe("chart viewport math", () => {
  const bounds: [number, number] = [0, 100];

  it("zooms around an arbitrary anchor and observes the minimum span", () => {
    expect(zoomChartViewport(bounds, bounds, 10, 0.5, 0.25)).toEqual([
      12.5, 62.5,
    ]);
    expect(zoomChartViewport(bounds, [20, 30], 10, 0.1, 0.5)).toEqual([20, 30]);
  });

  it("pans to either boundary without shrinking", () => {
    expect(panChartViewport(bounds, [20, 40], 10, -50)).toEqual([0, 20]);
    expect(panChartViewport(bounds, [20, 40], 10, 100)).toEqual([80, 100]);
  });

  it("fits invalid and over-wide ranges to the full horizon", () => {
    expect(clampChartViewport(bounds, [Number.NaN, 20], 10)).toEqual(bounds);
    expect(clampChartViewport(bounds, [-10, 120], 10)).toEqual(bounds);
  });

  it("frames point and duration events with context", () => {
    expect(eventChartViewport(bounds, 50, undefined, 10)).toEqual([40, 60]);
    expect(eventChartViewport(bounds, 40, 60, 10)).toEqual([38, 62]);
    expect(eventChartViewport(bounds, 2, undefined, 10)).toEqual([0, 20]);
    expect(eventChartViewport([0, 1000], 400, 900, 10)).toEqual([394, 454]);
  });
});
