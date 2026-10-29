import { TickPresentFutureType } from "../Types";
import { sampleForecastTimeline, sampleTimeline } from "./ForecastSampling";

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

    expect(sampleForecastTimeline(timeline, 240)).toEqual([
      timeline[0],
      timeline[2],
      timeline[4],
    ]);
  });

  it("does not add a redundant point to a linear fuel forecast", () => {
    const timeline = [tick(0, 0), tick(60, 25), tick(120, 50)];

    expect(sampleForecastTimeline(timeline, 120)).toEqual([
      timeline[0],
      timeline[2],
    ]);
  });

  it("keeps sparse recorded months that fall outside the hourly sampling window", () => {
    const timeline = Array.from({ length: 12 }, (_, month) =>
      tick(month * 1440, 100),
    );

    expect(sampleForecastTimeline(timeline, 420)).toEqual(timeline);
  });

  it("keeps each time bucket when a coarse forecast misses every sampling window", () => {
    const timeline = Array.from({ length: 8 }, (_, index) =>
      tick(75 + index * 240, 100),
    );

    expect(sampleForecastTimeline(timeline, 240)).toEqual(timeline);
  });
});

describe("sampleTimeline", () => {
  it.each([0, 1, 2])(
    "handles %i points without duplicate endpoints",
    (length) => {
      const timeline = Array.from({ length }, (_, index) =>
        tick(index * 15, 100),
      );
      expect(sampleTimeline(timeline, 240)).toEqual(timeline);
    },
  );

  it.each([0, 15, 30, 45])(
    "downsamples dense ticks starting at minute %i and retains both endpoints once",
    (offset) => {
      const timeline = Array.from({ length: 65 }, (_, index) =>
        tick(offset + index * 15, 100),
      );
      const sampled = sampleTimeline(timeline, 240);
      expect(sampled[0]).toBe(timeline[0]);
      expect(sampled.at(-1)).toBe(timeline.at(-1));
      expect(new Set(sampled).size).toBe(sampled.length);
      expect(sampled.length).toBeLessThanOrEqual(6);
      expect(
        new Set(sampled.map((point) => Math.floor(point.minute / 240))),
      ).toEqual(
        new Set(timeline.map((point) => Math.floor(point.minute / 240))),
      );
    },
  );
});
