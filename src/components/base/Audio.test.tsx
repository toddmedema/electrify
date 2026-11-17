import { isInstalledWebApp } from "../../InstalledApp";
import * as React from "react";
import { act, render } from "@testing-library/react";
import Audio, { StateProps } from "./Audio";
import {
  loadAudioFiles,
  pause,
  playSoundEffect,
  resume,
  setMusicInGame,
  setMusicVolume,
  setSoundEffectsVolume,
  state,
  unlockAudio,
} from "../../data/Audio";
import { INIT_DELAY } from "../../Constants";
import { achievementJournal } from "../../achievements/Journal";
import { recordIntent } from "../../achievements/Progress";

jest.mock("../../InstalledApp");

jest.mock("../../data/Audio", () => ({
  loadAudioFiles: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  unlockAudio: jest.fn(),
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
  (isInstalledWebApp as jest.Mock).mockReturnValue(false);
  state.loaded = "UNLOADED";
  localStorage.clear();
  achievementJournal.activate();
  achievementJournal.refresh();
  achievementJournal.setSteamAvailable(false);
  achievementJournal.clearNotifications();
});
afterEach(() => jest.useRealTimers());

it("chimes once for a batch of live achievements and again for a later award", () => {
  render(<Audio {...props} />);
  act(() => {
    achievementJournal.merge(
      recordIntent({ earned: ["FIRST_SPARK", "OUT_OF_JUICE"] }),
      true,
    );
  });
  expect(playSoundEffect).toHaveBeenCalledTimes(1);
  expect(playSoundEffect).toHaveBeenLastCalledWith("ACHIEVEMENT_UNLOCKED");
  act(() => {
    achievementJournal.merge(recordIntent({ earned: ["FIRST_SPARK"] }), true);
    achievementJournal.dismiss("FIRST_SPARK");
    achievementJournal.setSync("synced");
    achievementJournal.merge(recordIntent({ earned: ["LIGHTS_ON"] }), true);
  });
  expect(playSoundEffect).toHaveBeenCalledTimes(2);
});

it("keeps restored, synced and Steam-owned achievements silent", () => {
  achievementJournal.merge(recordIntent({ earned: ["FIRST_SPARK"] }), true);
  render(<Audio {...props} />);
  act(() => {
    achievementJournal.merge(recordIntent({ earned: ["OUT_OF_JUICE"] }));
    achievementJournal.setSteamAvailable(true);
    achievementJournal.merge(recordIntent({ earned: ["LIGHTS_ON"] }), true);
    achievementJournal.setSteamAvailable(false);
  });
  expect(playSoundEffect).not.toHaveBeenCalled();
});

it("discards muted awards and stops observing achievements on unmount", () => {
  const { rerender, unmount } = render(<Audio {...props} enabled={false} />);
  act(() => {
    achievementJournal.merge(recordIntent({ earned: ["FIRST_SPARK"] }), true);
  });
  rerender(<Audio {...props} />);
  expect(playSoundEffect).not.toHaveBeenCalled();
  unmount();
  act(() => {
    achievementJournal.merge(recordIntent({ earned: ["OUT_OF_JUICE"] }), true);
  });
  expect(playSoundEffect).not.toHaveBeenCalled();
});

it("discards hidden-page awards without replaying them on return", () => {
  const visibility = jest.spyOn(document, "visibilityState", "get");
  render(<Audio {...props} />);
  try {
    visibility.mockReturnValue("hidden");
    act(() => {
      achievementJournal.merge(recordIntent({ earned: ["FIRST_SPARK"] }), true);
    });
    visibility.mockReturnValue("visible");
    act(() => achievementJournal.setSync("synced"));
    expect(playSoundEffect).not.toHaveBeenCalled();
    act(() => {
      achievementJournal.merge(
        recordIntent({ earned: ["OUT_OF_JUICE"] }),
        true,
      );
    });
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
  } finally {
    visibility.mockRestore();
  }
});

it("disables unsupported audio once and stops trying on later gestures", () => {
  (loadAudioFiles as jest.Mock).mockImplementationOnce(() => {
    Object.assign(state, { loaded: "UNSUPPORTED" });
  });
  render(<Audio {...props} />);
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(props.disableAudio).toHaveBeenCalledTimes(1);
  jest.clearAllMocks();
  document.dispatchEvent(new Event("click"));
  document.dispatchEvent(new Event("touchend"));
  document.dispatchEvent(new Event("keydown"));
  expect(loadAudioFiles).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
  expect(unlockAudio).not.toHaveBeenCalled();
  expect(props.disableAudio).not.toHaveBeenCalled();
});

it("keeps retryable download errors enabled for a later gesture", () => {
  (loadAudioFiles as jest.Mock).mockImplementationOnce(() => {
    state.loaded = "ERROR";
  });
  render(<Audio {...props} />);
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(props.disableAudio).not.toHaveBeenCalled();
  document.dispatchEvent(new Event("click"));
  expect(loadAudioFiles).toHaveBeenCalledTimes(2);
  expect(props.disableAudio).not.toHaveBeenCalled();
});

it("reports unsupported installed-app audio when enabled after muted preparation", () => {
  (isInstalledWebApp as jest.Mock).mockReturnValue(true);
  (loadAudioFiles as jest.Mock).mockImplementationOnce(() => {
    Object.assign(state, { loaded: "UNSUPPORTED" });
  });
  const { rerender } = render(<Audio {...props} enabled={false} />);
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(props.disableAudio).not.toHaveBeenCalled();
  rerender(<Audio {...props} />);
  expect(props.disableAudio).toHaveBeenCalledTimes(1);
  expect(loadAudioFiles).toHaveBeenCalledTimes(1);
});

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

it("prepares installed-app music while muted, then resumes immediately when enabled", () => {
  (isInstalledWebApp as jest.Mock).mockReturnValue(true);
  const { rerender } = render(<Audio {...props} enabled={false} />);
  act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
  expect(loadAudioFiles).toHaveBeenCalledTimes(1);
  expect(resume).not.toHaveBeenCalled();
  state.loaded = "LOADED";
  rerender(<Audio {...props} />);
  expect(resume).toHaveBeenCalledTimes(1);
});

it("retries browser unlocking on gestures without rebuilding music, and removes its listeners", () => {
  state.loaded = "LOADED";
  const { unmount } = render(<Audio {...props} />);
  jest.clearAllMocks();
  document.dispatchEvent(new Event("touchend"));
  document.dispatchEvent(new Event("click"));
  document.dispatchEvent(new Event("keydown"));
  expect(unlockAudio).toHaveBeenCalledTimes(3);
  expect(resume).not.toHaveBeenCalled();
  expect(loadAudioFiles).not.toHaveBeenCalled();
  unmount();
  document.dispatchEvent(new Event("click"));
  expect(unlockAudio).toHaveBeenCalledTimes(3);
});

it("does not let delayed initialization resume an installed app that went into the background", () => {
  (isInstalledWebApp as jest.Mock).mockReturnValue(true);
  render(<Audio {...props} />);
  const visibility = jest
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  try {
    act(() => jest.advanceTimersByTime(INIT_DELAY.LOAD_AUDIO_MILLIS));
    expect(resume).not.toHaveBeenCalled();
    expect(loadAudioFiles).toHaveBeenCalledTimes(1);
  } finally {
    visibility.mockRestore();
  }
});
