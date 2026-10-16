import {
  MUSIC_DEFINITIONS,
  MUSIC_FADE_SECONDS,
  MUSIC_GAME_VOLUME,
} from "../Constants";
import { AudioNode } from "./AudioNode";
import {
  MUSIC_PRESSURE_HOLD_MS,
  MUSIC_PRESSURE_ATTACK_SECONDS,
  MUSIC_PRESSURE_RELEASE_SECONDS,
  ThemeManager,
} from "./ThemeManager";

const BASIC = MUSIC_DEFINITIONS.basic;
const BASIC_DURATION_SECONDS = BASIC.durationMs / 1000;

interface FakeSource {
  start: jest.Mock;
  stop: jest.Mock;
  connect: jest.Mock;
  buffer: AudioBuffer | null;
  loop: boolean;
}

/**
 * jsdom has no Web Audio, and none of these tests care about anything audible -- what they check
 * is the pair of arguments handed to source.start(): when on the context clock a track begins,
 * and how far into its buffer it starts. tickPerSource advances the clock as sources are built,
 * to stand in for real time passing while a theme's tracks are kicked off one after another.
 */
function fakeContext(tickPerSource: number = 0) {
  const sources: FakeSource[] = [];
  const gains: Array<{
    value: number;
    setValueAtTime: jest.Mock;
    cancelAndHoldAtTime: jest.Mock;
    linearRampToValueAtTime: jest.Mock;
  }> = [];
  const context = {
    currentTime: 0,
    destination: {},
    createGain: () => {
      const gain = {
        value: 1,
        setValueAtTime: jest.fn(),
        cancelAndHoldAtTime: jest.fn(),
        linearRampToValueAtTime: jest.fn(),
      };
      gains.push(gain);
      return {
        connect: jest.fn(),
        disconnect: jest.fn(),
        gain,
      };
    },
    createBufferSource: () => {
      const source: FakeSource = {
        start: jest.fn(),
        stop: jest.fn(),
        connect: jest.fn(),
        buffer: null,
        loop: false,
      };
      sources.push(source);
      context.currentTime += tickPerSource;
      return source;
    },
  };
  return { context, sources, gains };
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

function musicHarness() {
  const { context, sources, gains } = fakeContext();
  const nodes: { [key: string]: AudioNode } = {};
  for (const theme of Object.values(MUSIC_DEFINITIONS)) {
    const buffer = {
      duration: theme.durationMs / 1000 + (theme.loop ? 0 : 10),
    } as AudioBuffer;
    for (const track of theme.tracks) {
      nodes[`${theme.directory}${track}`] = new AudioNode(
        context as unknown as AudioContext,
        buffer,
      );
    }
  }
  return {
    themeManager: new ThemeManager(context as unknown as AudioContext, nodes),
    context,
    sources,
    gains,
  };
}

describe("menu and gameplay music", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("loops the menu on the audio clock without escalating into gameplay", () => {
    const { themeManager, sources } = musicHarness();
    themeManager.setIntensity(1);
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    expect(sources[0].buffer?.duration).toBe(
      MUSIC_DEFINITIONS.menu.durationMs / 1000,
    );
    jest.advanceTimersByTime(BASIC.durationMs * 2);
    expect(sources).toHaveLength(1);
    expect(sources[0].stop).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    "keeps existing sources and their position when the active theme is selected again (%s)",
    (intensity) => {
      const { themeManager, context, sources } = musicHarness();
      themeManager.setIntensity(intensity);
      const original = sources.slice();
      context.currentTime = 7;
      themeManager.setIntensity(intensity);
      context.currentTime = 18.5;
      themeManager.setIntensity(intensity);
      expect(sources).toEqual(original);
      for (const source of original) {
        expect(source.start).toHaveBeenCalledTimes(1);
        expect(source.stop).not.toHaveBeenCalled();
      }

      themeManager.pause();
      context.currentTime = 60;
      themeManager.resume();
      for (const source of sources.slice(original.length)) {
        expect(source.start).toHaveBeenCalledWith(60, 18.5);
      }
      const resumed = sources.length;
      context.currentTime = 65;
      themeManager.resume();
      expect(sources).toHaveLength(resumed);
    },
  );

  it("crossfades into the existing aligned gameplay tracks when a game starts", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(1);
    context.currentTime = 7;
    themeManager.setIntensity(2);
    expect(sources[0].stop).toHaveBeenCalledWith(7 + MUSIC_FADE_SECONDS);
    const gameplay = sources.slice(1);
    expect(gameplay).toHaveLength(BASIC.tracks.length);
    for (const source of gameplay) {
      expect(source.loop).toBe(false);
      expect(source.buffer?.duration).toBe(BASIC_DURATION_SECONDS + 10);
      expect(source.start).toHaveBeenCalledWith(7, 0);
    }
  });

  it("returns to the menu on quit and cancels the pending gameplay loop", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 15;
    themeManager.setIntensity(1);
    for (const source of sources.slice(0, BASIC.tracks.length)) {
      expect(source.stop).toHaveBeenCalledWith(15 + MUSIC_FADE_SECONDS);
    }
    expect(sources[BASIC.tracks.length].loop).toBe(true);
    jest.advanceTimersByTime(BASIC.durationMs * 2);
    expect(sources).toHaveLength(BASIC.tracks.length + 1);
  });

  it("resumes the menu at its position after several native loops", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(1);
    context.currentTime = (MUSIC_DEFINITIONS.menu.durationMs / 1000) * 3 + 12;
    themeManager.pause();
    context.currentTime += 50;
    themeManager.resume();
    expect(sources[1].loop).toBe(true);
    expect(sources[1].start.mock.calls[0][1]).toBeCloseTo(12);
  });

  it("does not carry the old song's seek position across a muted scene change", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 60;
    themeManager.pause();
    themeManager.setIntensity(1);
    expect(sources).toHaveLength(BASIC.tracks.length);
    context.currentTime = 90;
    themeManager.resume();
    expect(sources[BASIC.tracks.length].start).toHaveBeenCalledWith(90, 0);
    expect(sources[BASIC.tracks.length].loop).toBe(true);
  });

  it("stops the current looping source when music is stopped", () => {
    const { themeManager, sources } = musicHarness();
    themeManager.setIntensity(1);
    themeManager.setIntensity(0);
    expect(sources[0].stop).toHaveBeenCalled();
  });

  it("starts every game at zero with a fresh full loop timer", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(2);
    jest.advanceTimersByTime(60000);
    context.currentTime = 60;
    themeManager.setIntensity(1);
    jest.advanceTimersByTime(20000);
    context.currentTime = 80;
    themeManager.setIntensity(2);
    const restarted = sources.slice(-BASIC.tracks.length);
    for (const source of restarted) {
      expect(source.start).toHaveBeenCalledWith(80, 0);
    }
    const beforeWrap = sources.length;
    jest.advanceTimersByTime(BASIC.durationMs - 1);
    expect(sources).toHaveLength(beforeWrap);
    jest.advanceTimersByTime(1);
    expect(sources).toHaveLength(beforeWrap + BASIC.tracks.length);
  });
});

describe("dynamic gameplay music", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fades the full stable mix to 85% over five seconds, leaving menu gain unchanged", () => {
    const { themeManager, context, gains } = musicHarness();
    themeManager.setIntensity(1);
    expect(gains[0].linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 5);
    context.currentTime = 20;
    themeManager.setIntensity(2);
    for (const gain of gains.slice(1)) {
      expect(gain.setValueAtTime).toHaveBeenCalledWith(0, 20);
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
        MUSIC_GAME_VOLUME,
        25,
      );
    }
  });

  it("raises urgent layers smoothly without restarting sources or their playheads", () => {
    const { themeManager, context, gains, sources } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 20;
    themeManager.setIntensity(6);
    const targets = gains.map(
      (gain) => gain.linearRampToValueAtTime.mock.calls.slice(-1)[0][0],
    );
    expect(targets[0]).toBeGreaterThan(MUSIC_GAME_VOLUME);
    expect(targets[1]).toBeGreaterThan(targets[0]);
    expect(targets[2]).toBeGreaterThan(targets[1]);
    expect(targets[2]).toBeLessThan(1);
    for (const gain of gains) {
      expect(gain.cancelAndHoldAtTime).toHaveBeenLastCalledWith(20);
      expect(gain.linearRampToValueAtTime.mock.calls.slice(-1)[0][1]).toBe(
        20 + MUSIC_PRESSURE_ATTACK_SECONDS,
      );
    }
    expect(sources).toHaveLength(BASIC.tracks.length);
    for (const source of sources) {
      expect(source.start).toHaveBeenCalledTimes(1);
      expect(source.stop).not.toHaveBeenCalled();
    }
  });

  it("keeps the full scene fade when pressure changes immediately after entry", () => {
    const { themeManager, context, gains } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 1;
    themeManager.setIntensity(10);
    for (const gain of gains) {
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 5);
    }
  });

  it("caps severe blackouts at the old volume ceiling and delays a slow recovery", () => {
    const { themeManager, context, gains } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 20;
    themeManager.setIntensity(10);
    for (const gain of gains) {
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 23);
    }
    themeManager.setIntensity(2);
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS - 1);
    for (const gain of gains) {
      expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
    }
    context.currentTime = 28;
    jest.advanceTimersByTime(1);
    for (const gain of gains) {
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
        MUSIC_GAME_VOLUME,
        28 + MUSIC_PRESSURE_RELEASE_SECONDS,
      );
    }
  });

  it("uses the latest grid state after the hold and cancels recovery on renewed pressure", () => {
    const { themeManager, context, gains } = musicHarness();
    themeManager.setIntensity(10);
    themeManager.setIntensity(2);
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS / 2);
    themeManager.setIntensity(6);
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS / 2);
    expect(gains[1].linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0.925,
      MUSIC_PRESSURE_RELEASE_SECONDS,
    );
    context.currentTime = 20;
    themeManager.setIntensity(2);
    themeManager.setIntensity(10);
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS);
    for (const gain of gains) {
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
        1,
        20 + MUSIC_PRESSURE_ATTACK_SECONDS,
      );
    }
  });

  it("clears pending recovery on quit and keeps the menu at its authored level", () => {
    const { themeManager, gains } = musicHarness();
    themeManager.setIntensity(10);
    themeManager.setIntensity(2);
    themeManager.setIntensity(1);
    const ramps = gains.map(
      (gain) => gain.linearRampToValueAtTime.mock.calls.length,
    );
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS * 2);
    expect(
      gains.map((gain) => gain.linearRampToValueAtTime.mock.calls.length),
    ).toEqual(ramps);
    expect(gains[3].linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 5);
  });

  it("updates intensity while paused and resumes the same position at the latest mix", () => {
    const { themeManager, context, gains, sources } = musicHarness();
    themeManager.setIntensity(10);
    context.currentTime = 40;
    themeManager.pause();
    themeManager.setIntensity(2);
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS);
    expect(sources).toHaveLength(BASIC.tracks.length);
    context.currentTime = 90;
    themeManager.resume();
    for (const source of sources.slice(BASIC.tracks.length)) {
      expect(source.start).toHaveBeenCalledWith(90, 40);
    }
    for (const gain of gains.slice(BASIC.tracks.length)) {
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
        MUSIC_GAME_VOLUME,
        95,
      );
    }
  });
});

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
