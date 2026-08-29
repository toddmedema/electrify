import { SoundEffects, SoundEffectType } from "./SoundEffects";

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
  it("schedules a finite cue for every semantic effect", () => {
    const { context, starts, stops } = fakeContext();
    const effects = new SoundEffects(context as unknown as AudioContext);
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
      effects.play(cue);
      expect(starts.length).toBeGreaterThan(before);
    }
    expect(stops).toHaveLength(starts.length);
    expect(stops.every((stop, i) => stop > starts[i])).toBe(true);
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
