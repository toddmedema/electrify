import { waitFor } from "@testing-library/react";
import { AudioNode } from "../audio/AudioNode";
import { ThemeManager } from "../audio/ThemeManager";
import { getAudioContext } from "../Globals";
import { loadAudioFiles, setMusicInGame, state } from "./Audio";

jest.mock("../Globals", () => ({ getAudioContext: jest.fn() }));
jest.mock("../audio/ThemeManager");
jest.mock("../audio/SoundEffects");

interface PendingRequest {
  open: jest.Mock;
  send: jest.Mock;
  onload: (() => void) | null;
  response: ArrayBuffer;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(state, {
    loaded: "UNLOADED",
    themeManager: null,
    soundEffects: null,
    musicOutput: null,
    paused: false,
    inGame: false,
  });
});

afterEach(() => jest.restoreAllMocks());

it.each([false, true])(
  "uses the latest game state when decoding finishes (initial inGame=%s)",
  async (initialInGame) => {
    const requests: PendingRequest[] = [];
    jest.spyOn(window, "XMLHttpRequest").mockImplementation(() => {
      const request: PendingRequest = {
        open: jest.fn(),
        send: jest.fn(),
        onload: null,
        response: new ArrayBuffer(0),
      };
      requests.push(request);
      return request as unknown as XMLHttpRequest;
    });
    const context = {
      currentTime: 0,
      createGain: () => ({
        connect: jest.fn(),
        context: { currentTime: 0 },
        gain: { setValueAtTime: jest.fn() },
      }),
      decodeAudioData: (
        _bytes: ArrayBuffer,
        success: (buffer: AudioBuffer) => void,
      ) => success({ duration: 44 } as AudioBuffer),
    };
    (getAudioContext as jest.Mock).mockReturnValue(context);

    setMusicInGame(initialInGame);
    loadAudioFiles();
    expect(requests.map((request) => request.open.mock.calls[0][1])).toEqual([
      "audio/menu/quiet-current.wav",
      "audio/basic/low.mp3",
      "audio/basic/medium.mp3",
      "audio/basic/high.mp3",
    ]);
    setMusicInGame(!initialInGame);
    for (const request of requests) request.onload?.();
    await waitFor(() => expect(state.loaded).toBe("LOADED"));
    const constructor = ThemeManager as jest.MockedClass<typeof ThemeManager>;
    const manager = constructor.mock.instances[0];
    expect(constructor).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        "menu/quiet-current.wav": expect.any(AudioNode),
      }),
    );
    expect(manager.setIntensity).toHaveBeenLastCalledWith(
      initialInGame ? 1 : 2,
    );

    setMusicInGame(initialInGame);
    expect(manager.setIntensity).toHaveBeenLastCalledWith(
      initialInGame ? 2 : 1,
    );
  },
);
