import { TickPresentFutureType } from "../Types";
import { sampleForecastTimeline } from "./ForecastSampling";

function tick(minute: number, sunW: number): TickPresentFutureType {
  return {
    minute,
    supplyW: sunW,
    demandW: 100,
    supplyByFuel: { Sun: sunW },
  } as TickPresentFutureType;
}

describe("sampleForecastTimeline", () => {
  it("keeps a short fuel-output dip between regular forecast samples", () => {
    const timeline = [
      tick(0, 100),
      tick(60, 100),
      tick(120, 10),
      tick(180, 100),
      tick(240, 100),
    ];

    expect(sampleForecastTimeline(timeline, 240, 15)).toEqual([
      timeline[0],
      timeline[2],
      timeline[4],
    ]);
  });

  it("does not add a redundant point to a linear fuel forecast", () => {
    const timeline = [tick(0, 0), tick(60, 25), tick(120, 50)];

    expect(sampleForecastTimeline(timeline, 120, 15)).toEqual([
      timeline[0],
      timeline[2],
    ]);
  });
});
