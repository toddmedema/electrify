import {
  GRID_EFFECT_COOLDOWN_MS,
  SoundEffects,
  SoundEffectType,
} from "./SoundEffects";

function fakeContext() {
  const starts: number[] = [];
  const stops: number[] = [];
  const outputValues: number[] = [];
  const param = () => ({
    value: 1,
    setValueAtTime: jest.fn((value: number) => outputValues.push(value)),
    exponentialRampToValueAtTime: jest.fn(),
  });
  const context = {
    currentTime: 4,
    state: "running",
    destination: {},
    resume: jest.fn(() => Promise.resolve()),
    createGain: () => ({
      connect: jest.fn(),
      gain: param(),
    }),
    createOscillator: () => ({
      type: "sine",
      frequency: param(),
      connect: jest.fn(),
      start: jest.fn((at: number) => starts.push(at)),
      stop: jest.fn((at: number) => stops.push(at)),
    }),
  };
  return { context, starts, stops, outputValues };
}

describe("SoundEffects", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules a finite cue for every semantic effect", () => {
    const { context, starts, stops } = fakeContext();
    const cues: SoundEffectType[] = [
      "BLACKOUT",
      "POWER_RESTORED",
      "BUILD_COMMITTED",
      "CONSTRUCTION_COMPLETE",
      "VICTORY",
      "FAILURE",
    ];

    for (const cue of cues) {
      const before = starts.length;
      // A fresh manager here isolates the shape of each cue from the runtime cooldown policy.
      new SoundEffects(context as unknown as AudioContext).play(cue);
      expect(starts.length).toBeGreaterThan(before);
    }
    expect(stops).toHaveLength(starts.length);
    expect(stops.every((stop, i) => stop > starts[i])).toBe(true);
  });

  it("coalesces rapid grid transitions into one settled-state cue per ten seconds", () => {
    const { context, starts } = fakeContext();
    const effects = new SoundEffects(context as unknown as AudioContext);

    effects.play("BLACKOUT");
    const afterBlackout = starts.length;
    effects.play("POWER_RESTORED");
    expect(starts).toHaveLength(afterBlackout);

    jest.advanceTimersByTime(GRID_EFFECT_COOLDOWN_MS - 1);
    expect(starts).toHaveLength(afterBlackout);
    jest.advanceTimersByTime(1);
    expect(starts.length).toBeGreaterThan(afterBlackout);
  });

  it("drops a pending recovery when the grid goes dark again", () => {
    const { context, starts } = fakeContext();
    const effects = new SoundEffects(context as unknown as AudioContext);

    effects.play("BLACKOUT");
    const afterBlackout = starts.length;
    effects.play("POWER_RESTORED");
    effects.play("BLACKOUT");
    jest.advanceTimersByTime(GRID_EFFECT_COOLDOWN_MS);
    expect(starts).toHaveLength(afterBlackout);
  });

  it("throttles repeated construction cues without delaying a later one", () => {
    const { context, starts } = fakeContext();
    const effects = new SoundEffects(context as unknown as AudioContext);

    effects.play("CONSTRUCTION_COMPLETE");
    const afterFirst = starts.length;
    effects.play("CONSTRUCTION_COMPLETE");
    expect(starts).toHaveLength(afterFirst);
    jest.advanceTimersByTime(2_000);
    effects.play("CONSTRUCTION_COMPLETE");
    expect(starts.length).toBeGreaterThan(afterFirst);
  });

  it("mutes effects independently and clamps their volume", () => {
    const { context, starts, outputValues } = fakeContext();
    const effects = new SoundEffects(context as unknown as AudioContext);
    effects.setVolume(-1);
    effects.play("VICTORY");
    expect(starts).toHaveLength(0);

    effects.setVolume(2);
    effects.play("VICTORY");
    expect(starts.length).toBeGreaterThan(0);
    expect(outputValues).toEqual(expect.arrayContaining([0, 1]));
  });

  it("silences an in-flight cue while paused", () => {
    const { context, outputValues } = fakeContext();
    const effects = new SoundEffects(context as unknown as AudioContext);
    effects.setVolume(0.6);
    effects.pause();
    expect(outputValues[outputValues.length - 1]).toBe(0);
    effects.resume();
    expect(outputValues[outputValues.length - 1]).toBe(0.6);
  });
});
