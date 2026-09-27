import { TICK_MINUTES, TICK_MS } from "../Constants";
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
function startClock(speed: SpeedType) {
  let wallClockMs = 0;
  jest.spyOn(performance, "now").mockImplementation(() => wallClockMs);
  getStore().dispatch(quit());
  getStore().dispatch(resume(createGame({ scenarioId: 101 })));
  getStore().dispatch(loaded());
  getStore().dispatch(setSpeed(speed));

  // Presents a frame at the given wall time and returns how many ticks it ran
  return (atMs: number) => {
    const minute = getStore().getState().game.date.minute;
    wallClockMs = atMs;
    getStore().dispatch(tickAction());
    return (getStore().getState().game.date.minute - minute) / TICK_MINUTES;
  };
}

function ticksPerFrame(speed: SpeedType, hz: number, frames: number) {
  const presentFrame = startClock(speed);
  const frameMs = 1000 / hz;
  // Deterministic jitter up to ±0.4 ms, about what a compositor's timestamps wander by
  const jitter = (i: number) => Math.sin(i * 12.9898) * 0.4;
  const counts: number[] = [];
  for (let i = 1; i <= frames; i++) {
    counts.push(presentFrame(i * frameMs + jitter(i)));
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

  it("resumes a frozen page where it stopped instead of fast-forwarding", () => {
    const presentFrame = startClock("NORMAL");
    const frameMs = 1000 / 60;
    let nowMs = 0;
    for (let i = 0; i < 30; i++) {
      nowMs += frameMs;
      presentFrame(nowMs);
    }

    // Ten minutes pass with no frames and no hide event, as when an Android screen lock
    // freezes the page. The first frame back runs about a second's ticks, not ten minutes'
    nowMs += 10 * 60 * 1000;
    expect(
      Math.abs(presentFrame(nowMs) - 1000 / TICK_MS.NORMAL),
    ).toBeLessThanOrEqual(1);

    // No debt from the freeze carries over: the clock is back to its ordinary rate at once
    let total = 0;
    for (let i = 0; i < 60; i++) {
      nowMs += frameMs;
      total += presentFrame(nowMs);
    }
    expect(Math.abs(total - 1000 / TICK_MS.NORMAL)).toBeLessThanOrEqual(1);
  });
});
