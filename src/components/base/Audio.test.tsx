import * as React from "react";
import { act, render } from "@testing-library/react";
import Audio, { StateProps } from "./Audio";
import {
  loadAudioFiles,
  pause,
  resume,
  setMusicInGame,
  setMusicVolume,
  setSoundEffectsVolume,
  state,
} from "../../data/Audio";
import { INIT_DELAY } from "../../Constants";

jest.mock("../../data/Audio", () => ({
  loadAudioFiles: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setMusicInGame: jest.fn(),
  setMusicVolume: jest.fn(),
  setSoundEffectsVolume: jest.fn(),
  playSoundEffect: jest.fn(),
  state: { loaded: "UNLOADED" },
}));

const props: StateProps & { disableAudio: () => void } = {
  enabled: true,
  musicVolume: 1,
  soundEffectsVolume: 1,
  musicIntensity: 0,
  inGame: false,
  events: [],
  victoryOpen: false,
  dialogOpen: false,
  dialogTitle: "",
  disableAudio: jest.fn(),
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  state.loaded = "UNLOADED";
});
afterEach(() => jest.useRealTimers());

it("loads only the mounted instance in StrictMode", () => {
  render(
    <React.StrictMode>
      <Audio {...props} />
    </React.StrictMode>,
  );
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(loadAudioFiles).toHaveBeenCalledTimes(1);
});

it("cancels delayed loading when unmounted", () => {
  const { unmount } = render(<Audio {...props} />);
  unmount();
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(loadAudioFiles).not.toHaveBeenCalled();
  expect(pause).toHaveBeenCalled();
});

it("does not download audio when disabled before the delay", () => {
  const { rerender } = render(<Audio {...props} />);
  rerender(<Audio {...props} enabled={false} />);
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(loadAudioFiles).not.toHaveBeenCalled();
  expect(pause).toHaveBeenCalled();
  rerender(<Audio {...props} />);
  expect(loadAudioFiles).toHaveBeenCalledTimes(1);
});

it("selects gameplay before delayed audio loading when mounted inside a game", () => {
  render(<Audio {...props} inGame />);
  expect(setMusicInGame).toHaveBeenCalledWith(true, 0);
  expect(loadAudioFiles).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(loadAudioFiles).toHaveBeenCalledTimes(1);
});

it("changes music on entering and leaving a game, including while muted", () => {
  const { rerender } = render(<Audio {...props} />);
  expect(setMusicInGame).toHaveBeenLastCalledWith(false, 0);
  rerender(<Audio {...props} inGame />);
  expect(setMusicInGame).toHaveBeenLastCalledWith(true, 0);
  const changes = (setMusicInGame as jest.Mock).mock.calls.length;
  rerender(<Audio {...props} inGame musicVolume={0.4} />);
  expect(setMusicInGame).toHaveBeenCalledTimes(changes);
  rerender(<Audio {...props} enabled={false} />);
  expect(setMusicInGame).toHaveBeenLastCalledWith(false, 0);
});

it.each([false, true])(
  "leaves playback alone during unrelated card/UI and volume updates (inGame=%s)",
  (inGame) => {
    state.loaded = "LOADED";
    const initial = { ...props, inGame };
    const { rerender } = render(<Audio {...initial} />);
    act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
    jest.clearAllMocks();

    rerender(
      <Audio {...initial} events={[]} dialogOpen dialogTitle="Settings" />,
    );
    rerender(<Audio {...initial} events={[]} />);
    rerender(
      <Audio
        {...initial}
        events={[]}
        musicVolume={0.4}
        soundEffectsVolume={0.3}
      />,
    );
    expect(setMusicVolume).toHaveBeenCalledWith(0.4);
    expect(setSoundEffectsVolume).toHaveBeenCalledWith(0.3);
    expect(setMusicInGame).not.toHaveBeenCalled();
    expect(loadAudioFiles).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  },
);

it("keeps live music pressure current while audio is loading or disabled", () => {
  const { rerender } = render(<Audio {...props} inGame musicIntensity={0.3} />);
  expect(setMusicInGame).toHaveBeenLastCalledWith(true, 0.3);
  rerender(<Audio {...props} inGame musicIntensity={0.9} enabled={false} />);
  expect(setMusicInGame).toHaveBeenLastCalledWith(true, 0.9);
  expect(loadAudioFiles).not.toHaveBeenCalled();
});
