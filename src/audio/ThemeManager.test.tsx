import { MUSIC_DEFINITIONS, MUSIC_GAME_VOLUME } from "../Constants";
import { AudioNode } from "./AudioNode";
import {
  MUSIC_PRESSURE_HOLD_MS,
  MUSIC_PAUSE_FADE_SECONDS,
  ThemeManager,
} from "./ThemeManager";

const BASIC = MUSIC_DEFINITIONS.basic;
const BASIC_DURATION_SECONDS = 391.99347;
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
  const events = new EventTarget();
  const context = {
    currentTime: 0,
    state: "running" as AudioContextState,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
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
  const buffer = { duration: BASIC_DURATION_SECONDS } as AudioBuffer;
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
      duration:
        theme === MUSIC_DEFINITIONS.menu ? 43.63637 : BASIC_DURATION_SECONDS,
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

describe("native music lifecycle", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([1, 2])(
    "keeps the same looping sources through ten song boundaries and timer stalls (%s)",
    (intensity) => {
      const { themeManager, context, sources } = musicHarness();
      themeManager.setIntensity(intensity);
      const count = intensity === 1 ? 1 : 3;
      expect(sources).toHaveLength(count);
      expect(sources.every((source) => source.loop)).toBe(true);
      context.currentTime = BASIC_DURATION_SECONDS * 10 + 60;
      jest.advanceTimersByTime(BASIC_DURATION_SECONDS * 10000);
      themeManager.setIntensity(intensity);
      expect(sources).toHaveLength(count);
      for (const source of sources) {
        expect(source.start).toHaveBeenCalledTimes(1);
        expect(source.stop).not.toHaveBeenCalled();
      }
    },
  );

  it("crossfades only when entering or leaving gameplay", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(1);
    context.currentTime = 20;
    themeManager.setIntensity(2);
    expect(sources[0].stop).toHaveBeenCalledWith(25);
    for (const source of sources.slice(1))
      expect(source.start).toHaveBeenCalledWith(20.02, 0);
    themeManager.setIntensity(6);
    expect(sources).toHaveLength(4);
    context.currentTime = 40;
    themeManager.setIntensity(1);
    for (const source of sources.slice(1, 4))
      expect(source.stop).toHaveBeenCalledWith(45);
    expect(sources[4].start).toHaveBeenCalledWith(40.02, 0);
  });

  it.each([1, 2])(
    "resumes the decoded loop position after several repetitions (%s)",
    (intensity) => {
      const { themeManager, context, sources } = musicHarness();
      themeManager.setIntensity(intensity);
      const count = sources.length;
      const duration = sources[0].buffer!.duration;
      context.currentTime = 0.02 + duration * 3 + 12;
      themeManager.pause();
      const stopAt = context.currentTime + MUSIC_PAUSE_FADE_SECONDS;
      for (const source of sources)
        expect(source.stop).toHaveBeenCalledWith(stopAt);
      context.currentTime = 2000;
      themeManager.resume();
      for (const source of sources.slice(count)) {
        expect(source.start.mock.calls[0][0]).toBe(2000.02);
        expect(source.start.mock.calls[0][1]).toBeCloseTo(12);
      }
      themeManager.resume();
      expect(sources).toHaveLength(count * 2);
    },
  );

  it("keeps stem starts aligned while node creation takes time", () => {
    const { themeManager, context, sources } = playingBasicTheme(0.001);
    context.currentTime = 40.02;
    themeManager.pause();
    themeManager.resume();
    const starts = sources.slice(3).map((source) => source.start.mock.calls[0]);
    expect(starts).toEqual(Array.from({ length: 3 }, () => starts[0]));
    expect(starts[0][0]).toBeCloseTo(40.04);
    expect(starts[0][1]).toBe(40);
  });

  it("does not carry an old seek or start sources when scenes change while paused", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 60;
    themeManager.pause();
    themeManager.setIntensity(1);
    expect(sources).toHaveLength(3);
    context.currentTime = 90;
    themeManager.resume();
    expect(sources[3].start).toHaveBeenCalledWith(90.02, 0);
  });

  it("keeps sources through browser context suspension and ignores redundant resume", () => {
    const { themeManager, context, sources } = playingBasicTheme();
    context.state = "suspended";
    jest.advanceTimersByTime(1000000);
    context.state = "running";
    themeManager.resume();
    expect(sources).toHaveLength(3);
    expect(sources.every((source) => !source.stop.mock.calls.length)).toBe(
      true,
    );
  });

  it("stops once on repeated pauses, including before the scheduled start", () => {
    const { themeManager, sources } = playingBasicTheme();
    themeManager.pause();
    themeManager.pause();
    themeManager.resume();
    for (const source of sources.slice(0, 3))
      expect(source.stop).toHaveBeenCalledTimes(1);
    for (const source of sources.slice(3))
      expect(source.start.mock.calls[0][1]).toBe(0);
  });

  it("mutes every outgoing copy during a rapid scene change and pause", () => {
    const { themeManager, context, sources } = musicHarness();
    themeManager.setIntensity(1);
    context.currentTime = 10;
    themeManager.setIntensity(2);
    context.currentTime = 11;
    themeManager.setIntensity(1);
    context.currentTime = 12;
    themeManager.pause();
    for (const source of sources)
      expect(source.stop).toHaveBeenLastCalledWith(12.05);
  });

  it("honors zero intensity across pause/resume and starts fresh afterward", () => {
    const { themeManager, sources } = playingBasicTheme();
    themeManager.setIntensity(0);
    themeManager.pause();
    themeManager.resume();
    expect(sources).toHaveLength(3);
    themeManager.setIntensity(2);
    expect(sources).toHaveLength(6);
    for (const source of sources.slice(3))
      expect(source.start.mock.calls[0][1]).toBe(0);
  });
});

describe("dynamic gameplay mix", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("keeps the full initial fade while pressure rises, without recreating sources", () => {
    const { themeManager, context, gains, sources } = musicHarness();
    themeManager.setIntensity(2);
    for (const gain of gains.slice(0, 2))
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
        MUSIC_GAME_VOLUME,
        5.02,
      );
    expect(gains[2].linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 5.02);
    context.currentTime = 1;
    themeManager.setIntensity(10);
    for (const gain of gains)
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 5.02);
    expect(sources).toHaveLength(3);
  });

  it.each([
    ["calm", 2, 0],
    ["just below healthy reserves", 2.001, 0.177827941],
    ["low reserves", 4, 0.177827941],
    ["exhausted reserves without a blackout", 6, 0.177827941],
    ["a small blackout", 7.6, 1],
    ["a severe blackout", 10, 1],
  ])("sets the high layer's gain for %s", (_state, intensity, expectedGain) => {
    const { themeManager, gains } = musicHarness();
    themeManager.setIntensity(intensity);
    const target = gains[2].linearRampToValueAtTime.mock.calls.at(-1)![0];
    expect(target).toBeCloseTo(expectedGain, 8);
  });

  it("fades the high layer up over three seconds and back to silence after a recovery hold", () => {
    const { themeManager, context, gains, sources } = musicHarness();
    themeManager.setIntensity(2);
    context.currentTime = 20;
    themeManager.setIntensity(6);
    const targets = gains.map(
      (gain) => gain.linearRampToValueAtTime.mock.calls.at(-1)![0],
    );
    expect(targets[0]).toBeGreaterThan(MUSIC_GAME_VOLUME);
    expect(targets[1]).toBeGreaterThan(targets[0]);
    expect(targets[2]).toBeCloseTo(0.177827941, 8);
    expect(gains[2].cancelAndHoldAtTime).toHaveBeenLastCalledWith(20);
    expect(gains[2].linearRampToValueAtTime.mock.calls.at(-1)![1]).toBe(23);
    context.currentTime = 24;
    themeManager.setIntensity(7.6);
    expect(gains[2].linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 27);
    themeManager.setIntensity(2);
    jest.advanceTimersByTime(MUSIC_PRESSURE_HOLD_MS - 1);
    expect(gains[2].linearRampToValueAtTime).toHaveBeenCalledTimes(3);
    context.currentTime = 32;
    jest.advanceTimersByTime(1);
    for (const gain of gains.slice(0, 2))
      expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(
        MUSIC_GAME_VOLUME,
        42,
      );
    expect(gains[2].cancelAndHoldAtTime).toHaveBeenLastCalledWith(32);
    expect(gains[2].linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 42);
    expect(sources).toHaveLength(3);
  });

  it("reads the latest recovery and cancels it on renewed pressure or a scene change", () => {
    const { themeManager, context, gains } = musicHarness();
    themeManager.setIntensity(10);
    context.currentTime = 20;
    themeManager.setIntensity(2);
    jest.advanceTimersByTime(4000);
    themeManager.setIntensity(6);
    jest.advanceTimersByTime(4000);
    expect(gains[1].linearRampToValueAtTime).toHaveBeenLastCalledWith(
      0.925,
      30,
    );
    expect(gains[2].linearRampToValueAtTime.mock.calls.at(-1)![0]).toBeCloseTo(
      0.177827941,
      8,
    );
    themeManager.setIntensity(2);
    themeManager.setIntensity(10);
    expect(jest.getTimerCount()).toBe(0);
    themeManager.setIntensity(2);
    themeManager.setIntensity(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(gains[3].linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 25.02);
  });

  it("resumes paused gameplay at its saved position using the latest pressure", () => {
    const { themeManager, context, gains, sources } = musicHarness();
    themeManager.setIntensity(10);
    context.currentTime = 40.02;
    themeManager.pause();
    themeManager.setIntensity(2);
    context.currentTime = 90;
    themeManager.resume();
    for (const source of sources.slice(3))
      expect(source.start).toHaveBeenCalledWith(90.02, 40);
    for (const gain of gains.slice(3, 5))
      expect(gain.linearRampToValueAtTime.mock.calls.at(-1)![0]).toBe(
        MUSIC_GAME_VOLUME,
      );
    expect(gains[5].linearRampToValueAtTime.mock.calls.at(-1)![0]).toBe(0);
  });
});

describe("AudioNode", () => {
  it("wraps a looping seek using the real buffer duration", () => {
    const { context, sources } = fakeContext();
    const node = new AudioNode(
      context as unknown as AudioContext,
      { duration: 30 } as AudioBuffer,
    );
    node.play(1, 75, 10, 0.1);
    expect(sources[0].start).toHaveBeenCalledWith(10, 15);
  });
});
