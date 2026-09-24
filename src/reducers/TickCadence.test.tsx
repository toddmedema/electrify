import { TICK_MS } from "../Constants";
import { getStore } from "../StoreRegistry";
import { createGame } from "../testing/Simulator";
import { SpeedType } from "../Types";
import { loaded, quit, resume, setSpeed, tick as tickAction } from "./Game";

/**
 * FAST and ULTRA were chosen to divide evenly into 60 and 120 Hz frames. That only reaches the
 * screen if every presented frame runs the same number of ticks, even though real frame
 * timestamps jitter by a fraction of a millisecond. This drives the real tick reducer through the
 * store with jittered frame times and counts the ticks each frame ran.
 */
function ticksPerFrame(speed: SpeedType, hz: number, frames: number) {
  let wallClockMs = 0;
  jest.spyOn(performance, "now").mockImplementation(() => wallClockMs);
  getStore().dispatch(quit());
  getStore().dispatch(resume(createGame({ scenarioId: 101 })));
  getStore().dispatch(loaded());
  getStore().dispatch(setSpeed(speed));

  const frameMs = 1000 / hz;
  // Deterministic jitter up to ±0.4 ms, about what a compositor's timestamps wander by
  const jitter = (i: number) => Math.sin(i * 12.9898) * 0.4;
  const counts: number[] = [];
  let minute = getStore().getState().game.date.minute;
  for (let i = 1; i <= frames; i++) {
    wallClockMs = i * frameMs + jitter(i);
    getStore().dispatch(tickAction());
    const next = getStore().getState().game.date.minute;
    counts.push((next - minute) / 15);
    minute = next;
  }
  return counts;
}

describe("tick cadence on display frames", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    getStore().dispatch(quit());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    ["FAST", 60, 1],
    ["FAST", 120, 0.5],
    ["ULTRA", 60, 2],
    ["ULTRA", 120, 1],
  ] as const)(
    "%s at %i Hz runs an even %p ticks per frame",
    (speed, hz, perFrame) => {
      // Skip the first frames, where the loop is still settling from its start
      const counts = ticksPerFrame(speed, hz, 240).slice(4);
      // Every run of frames just long enough to hold a whole tick holds the same number. At half a
      // tick a frame that means strictly alternating frames, never two ticks or two gaps in a row
      const window = Math.max(1, Math.round(1 / perFrame));
      const sums = counts
        .slice(0, counts.length - window + 1)
        .map((_, i) =>
          counts.slice(i, i + window).reduce((sum, count) => sum + count, 0),
        );
      expect(new Set(sums)).toEqual(new Set([perFrame * window]));
    },
  );

  it("keeps the long-run rate exact", () => {
    const counts = ticksPerFrame("FAST", 60, 600);
    const total = counts.reduce((sum, count) => sum + count, 0);
    expect(
      Math.abs(total - (600 * (1000 / 60)) / TICK_MS.FAST),
    ).toBeLessThanOrEqual(1);
  });
});
