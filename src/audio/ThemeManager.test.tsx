import { MUSIC_DEFINITIONS } from "../Constants";
import { AudioNode } from "./AudioNode";
import { ThemeManager } from "./ThemeManager";

const BASIC = MUSIC_DEFINITIONS.basic;
const BASIC_DURATION_SECONDS = BASIC.durationMs / 1000;

interface FakeSource {
  start: jest.Mock;
  stop: jest.Mock;
  connect: jest.Mock;
  buffer: AudioBuffer | null;
}

/**
 * jsdom has no Web Audio, and none of these tests care about anything audible -- what they check
 * is the pair of arguments handed to source.start(): when on the context clock a track begins,
 * and how far into its buffer it starts. tickPerSource advances the clock as sources are built,
 * to stand in for real time passing while a theme's tracks are kicked off one after another.
 */
function fakeContext(tickPerSource: number = 0) {
  const sources: FakeSource[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    createGain: () => {
      return {
        connect: jest.fn(),
        disconnect: jest.fn(),
        gain: {
          value: 1,
          setValueAtTime: jest.fn(),
          linearRampToValueAtTime: jest.fn(),
        },
      };
    },
    createBufferSource: () => {
      const source: FakeSource = {
        start: jest.fn(),
        stop: jest.fn(),
        connect: jest.fn(),
        buffer: null,
      };
      sources.push(source);
      context.currentTime += tickPerSource;
      return source;
    },
  };
  return { context, sources };
}

// A manager already playing the basic theme, which is the long one (6+ minutes) where restarting
// from the top on every tab switch is most obvious.
function playingBasicTheme(tickPerSource: number = 0) {
  const { context, sources } = fakeContext(tickPerSource);
  // Music files are deliberately longer than their listed duration, to leave room for reverb
  const buffer = { duration: BASIC_DURATION_SECONDS + 10 } as AudioBuffer;
  const nodes: { [key: string]: AudioNode } = {};
  for (const track of BASIC.tracks) {
    nodes[`${BASIC.directory}${track}`] = new AudioNode(
      context as unknown as AudioContext,
      buffer,
    );
  }
  const themeManager = new ThemeManager(
    context as unknown as AudioContext,
    nodes,
  );
  themeManager.setIntensity(2); // starts the basic theme from silence
  return { themeManager, context, sources };
}

describe("ThemeManager pause / resume", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("picks the theme back up where it was paused", () => {
    const { themeManager, context, sources } = playingBasicTheme();
    expect(sources).toHaveLength(BASIC.tracks.length);

    context.currentTime = 40;
    themeManager.pause();
    context.currentTime = 95; // 55 seconds spent on another tab
    themeManager.resume();

    // Buffer sources are single-use, so resuming builds a fresh one per track -- each seeking to
    // where the pause happened rather than to the top of the file
    const resumed = sources.slice(BASIC.tracks.length);
    expect(resumed).toHaveLength(BASIC.tracks.length);
    for (const source of resumed) {
      expect(source.start).toHaveBeenCalledWith(95, 40);
    }
  });

  it("starts every track of a resumed theme together", () => {
    // The stems are written to play on top of each other, so a per-track clock reading would let
    // them drift apart by however long the theme takes to start
    const { themeManager, context, sources } = playingBasicTheme(0.01);
    context.currentTime = 40;
    themeManager.pause();
    themeManager.resume();

    const resumed = sources.slice(BASIC.tracks.length);
    const startArgs = resumed.map((source) => source.start.mock.calls[0]);
    for (const args of startArgs) {
      expect(args).toEqual(startArgs[0]);
    }
  });

  it("wraps a resumed theme after what is left of it, not its full length", () => {
    const { themeManager, context, sources } = playingBasicTheme();
    context.currentTime = 40;
    themeManager.pause();
    themeManager.resume();
    const beforeWrap = sources.length;

    jest.advanceTimersByTime(BASIC.durationMs - 40000 - 1);
    expect(sources).toHaveLength(beforeWrap);

    // Arming the loop with the full duration instead would push this 40 seconds later, and drift
    // further on every pause / resume
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(beforeWrap + BASIC.tracks.length);
  });

  it("restarts the theme when the pause lands past its end", () => {
    const { themeManager, context, sources } = playingBasicTheme();
    // The loop timer can run long when a background tab throttles timers
    context.currentTime = BASIC_DURATION_SECONDS + 5;
    themeManager.pause();
    themeManager.resume();

    const resumed = sources.slice(BASIC.tracks.length);
    for (const source of resumed) {
      expect(source.start).toHaveBeenCalledWith(expect.any(Number), 0);
    }
  });

  it("ignores a resume that was not preceded by a pause", () => {
    const { themeManager, sources } = playingBasicTheme();
    themeManager.resume();
    expect(sources).toHaveLength(BASIC.tracks.length);
  });
});

describe("AudioNode seeking", () => {
  it("falls back to the top of the track when the seek is past the buffer", () => {
    const { context, sources } = fakeContext();
    const buffer = { duration: 30 } as AudioBuffer;
    const node = new AudioNode(context as unknown as AudioContext, buffer);

    // Silence would be the alternative -- a source started past the end of its buffer never plays
    node.playOnce(1, 0, 45, 10);
    expect(sources[0].start).toHaveBeenCalledWith(10, 0);
  });
});
