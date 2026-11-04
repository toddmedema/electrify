import { waitFor } from "@testing-library/react";
import { AudioNode } from "../audio/AudioNode";
import { ThemeManager } from "../audio/ThemeManager";
import { getAudioContext } from "../Globals";
import {
  loadAudioFiles,
  loadAudioLocalFile,
  pause,
  resume,
  setMusicInGame,
  state,
  unlockAudio,
} from "./Audio";

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
    musicIntensity: 0,
    nodes: {},
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
      decodeAudioData: jest
        .fn()
        .mockResolvedValue({ duration: 44 } as AudioBuffer),
    };
    (getAudioContext as jest.Mock).mockReturnValue(context);

    setMusicInGame(initialInGame);
    loadAudioFiles();
    loadAudioFiles(); // A second owner must not duplicate requests, decoding, or output buses.
    expect(requests).toHaveLength(1);
    expect(requests[0].open).toHaveBeenCalledWith(
      "GET",
      "audio/menu/quiet-current.wav",
      true,
    );
    setMusicInGame(!initialInGame, 0.5);
    requests[0].onload?.();
    await waitFor(() => expect(ThemeManager).toHaveBeenCalledTimes(1));
    const earlyManager = (ThemeManager as jest.MockedClass<typeof ThemeManager>)
      .mock.instances[0];
    expect(earlyManager.setIntensity).toHaveBeenLastCalledWith(1);
    expect(state.loaded).toBe("LOADING");
    for (let i = 1; i < 4; i++) {
      await waitFor(() => expect(requests).toHaveLength(i + 1));
      requests[i].onload?.();
    }
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
      initialInGame ? 1 : 6,
    );

    setMusicInGame(initialInGame);
    expect(manager.setIntensity).toHaveBeenLastCalledWith(
      initialInGame ? 2 : 1,
    );
  },
);

it("unlocks suspended audio immediately when resuming, before any files finish loading", () => {
  const context = {
    state: "suspended",
    resume: jest.fn().mockResolvedValue(undefined),
  };
  (getAudioContext as jest.Mock).mockReturnValue(context);
  resume();
  expect(context.resume).toHaveBeenCalledTimes(1);
});

it.each(["suspended", "interrupted"])(
  "handles rejected %s unlocking and retries on a later gesture",
  async (contextState) => {
    const context = {
      state: contextState,
      resume: jest.fn().mockRejectedValue(new Error("blocked")),
    };
    (getAudioContext as jest.Mock).mockReturnValue(context);
    unlockAudio();
    await Promise.resolve();
    context.resume.mockResolvedValue(undefined);
    unlockAudio();
    expect(context.resume).toHaveBeenCalledTimes(2);
  },
);

it("retries failed gameplay decoding without recreating the menu, outputs, or decoded tracks", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const requests: {
    url: string;
    onload?: () => void;
    response: ArrayBuffer;
    status: number;
  }[] = [];
  jest.spyOn(window, "XMLHttpRequest").mockImplementation(() => {
    const request = {
      url: "",
      onload: undefined as (() => void) | undefined,
      response: new ArrayBuffer(0),
      status: 200,
      open: (_method: string, url: string) => {
        request.url = url;
      },
      send: () => {
        requests.push(request);
        queueMicrotask(() => request.onload?.());
      },
    };
    return request as unknown as XMLHttpRequest;
  });
  const gain = {
    connect: jest.fn(),
    context: { currentTime: 0 },
    gain: { setValueAtTime: jest.fn() },
  };
  const context = {
    createGain: jest.fn(() => gain),
    decodeAudioData: jest
      .fn()
      .mockResolvedValue({ duration: 44 })
      .mockResolvedValueOnce({ duration: 44 })
      .mockRejectedValueOnce(new Error("decode failed")),
  };
  (getAudioContext as jest.Mock).mockReturnValue(context);
  pause();
  await loadAudioFiles();
  expect(state.loaded).toBe("ERROR");
  expect(state.themeManager).not.toBeNull();
  expect(state.themeManager!.pause).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  await loadAudioFiles();
  expect(state.loaded).toBe("LOADED");
  expect(context.createGain).toHaveBeenCalledTimes(1);
  expect(ThemeManager).toHaveBeenCalledTimes(1);
  expect(
    requests.filter((request) => request.url.includes("quiet-current")),
  ).toHaveLength(1);
  expect(
    requests.filter((request) => request.url.includes("low.mp3")),
  ).toHaveLength(2);
});

it("rejects HTTP audio errors without decoding an error page", async () => {
  let request: { status: number; onload?: () => void };
  jest.spyOn(window, "XMLHttpRequest").mockImplementation(() => {
    request = {
      status: 404,
      open: jest.fn(),
      send: jest.fn(),
    } as typeof request;
    return request as unknown as XMLHttpRequest;
  });
  const context = { decodeAudioData: jest.fn() };
  const pending = loadAudioLocalFile(
    context as unknown as AudioContext,
    "audio/missing.mp3",
  );
  request!.onload?.();
  await expect(pending).rejects.toThrow("404");
  expect(context.decodeAudioData).not.toHaveBeenCalled();
});
