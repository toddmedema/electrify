import * as React from "react";
import { act, render } from "@testing-library/react";
import Audio, { StateProps } from "./Audio";
import { loadAudioFiles, pause, state } from "../../data/Audio";
import { INIT_DELAY } from "../../Constants";

jest.mock("../../data/Audio", () => ({
  loadAudioFiles: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  setMusicVolume: jest.fn(),
  setSoundEffectsVolume: jest.fn(),
  playSoundEffect: jest.fn(),
  state: { loaded: "UNLOADED" },
}));

const props: StateProps & { disableAudio: () => void } = {
  enabled: true,
  musicVolume: 1,
  soundEffectsVolume: 1,
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
