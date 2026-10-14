import { ControllerFeedback, MenuFeedbackAudio } from "./MenuFeedback";

jest.mock("../Globals", () => ({ getAudioContext: jest.fn() }));

function audioHarness() {
  const sources: { start: jest.Mock; stop: jest.Mock }[] = [];
  const gains: {
    gain: { setValueAtTime: jest.Mock };
    disconnect: jest.Mock;
  }[] = [];
  const context = {
    state: "running",
    currentTime: 2,
    destination: {},
    resume: jest.fn(async () => undefined),
    createBufferSource: jest.fn(() => {
      const source = {
        start: jest.fn(),
        stop: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      sources.push(source);
      return source;
    }),
    createGain: jest.fn(() => {
      const gain = {
        gain: { setValueAtTime: jest.fn() },
        connect: jest.fn(),
        disconnect: jest.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };
  const settings = { audioEnabled: true, soundEffectsVolume: 0.4 };
  let foreground = true;
  const create = jest.fn(() => context as unknown as AudioContext);
  const load = jest.fn(async () => ({ duration: 0.05 }) as AudioBuffer);
  const audio = new MenuFeedbackAudio(
    () => settings,
    () => foreground,
    create,
    load,
  );
  return {
    audio,
    context,
    settings,
    sources,
    gains,
    create,
    load,
    blur: () => {
      foreground = false;
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("does nothing before a cue, respects mute/zero volume, and uses the effects bus for quiet playback", async () => {
  const h = audioHarness();
  expect(h.create).not.toHaveBeenCalled();
  h.settings.audioEnabled = false;
  await h.audio.play("confirm");
  h.settings.audioEnabled = true;
  h.settings.soundEffectsVolume = 0;
  await h.audio.play("confirm");
  expect(h.load).not.toHaveBeenCalled();
  h.settings.soundEffectsVolume = 0.4;
  await h.audio.play("confirm");
  expect(h.load).toHaveBeenCalledTimes(3);
  expect(h.sources[0].start).toHaveBeenCalledTimes(1);
  expect(h.gains[0].gain.setValueAtTime.mock.calls[0][0]).toBeCloseTo(0.22);
  expect(h.gains[0].gain.setValueAtTime.mock.calls[0][1]).toBe(2);
});

it("deduplicates bursts, gives confirmation priority, and stops current sources", async () => {
  const h = audioHarness();
  await h.audio.play("select");
  await h.audio.play("select");
  expect(h.sources).toHaveLength(1);
  await h.audio.play("confirm");
  expect(h.sources).toHaveLength(2);
  expect(h.sources[0].stop).toHaveBeenCalledTimes(1);
  h.audio.stop();
  expect(h.sources[1].stop).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(141);
  await h.audio.play("back");
  expect(h.sources).toHaveLength(3);
});

it("cancels pending decode when focus is lost or the preference is muted", async () => {
  const h = audioHarness();
  let finish!: (buffer: AudioBuffer) => void;
  const decoded = new Promise<AudioBuffer>((resolve) => {
    finish = resolve;
  });
  h.load.mockReturnValue(decoded);
  const playback = h.audio.play("select");
  h.blur();
  h.audio.stop();
  finish({ duration: 0.05 } as AudioBuffer);
  await playback;
  expect(h.sources).toHaveLength(0);

  const muted = audioHarness();
  let release!: (buffer: AudioBuffer) => void;
  const buffer = new Promise<AudioBuffer>((resolve) => {
    release = resolve;
  });
  muted.load.mockReturnValue(buffer);
  const pending = muted.audio.play("confirm");
  muted.settings.audioEnabled = false;
  release({ duration: 0.05 } as AudioBuffer);
  await pending;
  expect(muted.sources).toHaveLength(0);
});

it("resumes during the gesture and treats decoding or resume failure as optional", async () => {
  const h = audioHarness();
  h.context.state = "suspended";
  h.load.mockRejectedValueOnce(new Error("missing local file"));
  await h.audio.play("back");
  expect(h.context.resume).toHaveBeenCalledTimes(1);
  expect(h.sources).toHaveLength(0);
  jest.advanceTimersByTime(141);
  await h.audio.play("back");
  expect(h.sources).toHaveLength(1);
});

it("uses a brief low-magnitude actuator independently of sound and resets it", async () => {
  let allowed = true;
  const actuator = {
    playEffect: jest.fn(async () => "complete"),
    reset: jest.fn(async () => "complete"),
  };
  const pads = () => [
    { connected: true, vibrationActuator: actuator } as unknown as Gamepad,
  ];
  const haptics = new ControllerFeedback(() => allowed, pads);
  haptics.play("confirm");
  haptics.play("confirm");
  expect(actuator.playEffect).toHaveBeenCalledTimes(1);
  expect(actuator.playEffect).toHaveBeenCalledWith(
    "dual-rumble",
    expect.objectContaining({
      duration: 35,
      strongMagnitude: 0.12,
      weakMagnitude: 0.18,
    }),
  );
  haptics.stop();
  expect(actuator.reset).toHaveBeenCalledTimes(1);
  allowed = false;
  jest.advanceTimersByTime(181);
  haptics.play("milestone");
  expect(actuator.playEffect).toHaveBeenCalledTimes(1);
  allowed = true;
  haptics.play("milestone");
  expect(actuator.playEffect).toHaveBeenLastCalledWith(
    "dual-rumble",
    expect.objectContaining({ duration: 70 }),
  );
});

it("ignores unsupported, disconnected and rejected actuators", async () => {
  const failed = {
    playEffect: jest.fn(async () => {
      throw new Error("unsupported");
    }),
    reset: jest.fn(async () => "complete"),
  };
  new ControllerFeedback(
    () => true,
    () => [null],
  ).play("confirm");
  new ControllerFeedback(
    () => true,
    () => [
      { connected: false, vibrationActuator: failed } as unknown as Gamepad,
    ],
  ).play("confirm");
  expect(failed.playEffect).not.toHaveBeenCalled();
  const haptics = new ControllerFeedback(
    () => true,
    () => [
      { connected: true, vibrationActuator: failed } as unknown as Gamepad,
    ],
  );
  haptics.play("confirm");
  await Promise.resolve();
  await Promise.resolve();
  haptics.stop();
  expect(failed.reset).not.toHaveBeenCalled();
});
