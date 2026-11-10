import { AudioNode } from "../audio/AudioNode";
import { ThemeManager } from "../audio/ThemeManager";
import { SoundEffects, SoundEffectType } from "../audio/SoundEffects";
import { MUSIC_DEFINITIONS, MUSIC_INTENSITY_MAX } from "../Constants";
import { getAudioContext } from "../Globals";
import { AudioLoadingType } from "../Types";

export const state = {
  loaded: "UNLOADED" as AudioLoadingType,
  themeManager: null as ThemeManager | null,
  soundEffects: null as SoundEffects | null,
  musicOutput: null as GainNode | null,
  paused: true,
  inGame: false,
  musicIntensity: 0,
  nodes: {} as Record<string, AudioNode>,
};

/** Remember the latest grid state while files load or audio is disabled. */
export function setMusicInGame(inGame: boolean, musicIntensity: number = 0) {
  state.inGame = inGame;
  state.musicIntensity = musicIntensity;
  state.themeManager?.setIntensity(playbackIntensity());
}

function playbackIntensity(): number {
  return state.inGame && state.loaded === "LOADED"
    ? 2 +
        Math.min(1, Math.max(0, state.musicIntensity)) *
          (MUSIC_INTENSITY_MAX - 2)
    : 1;
}

export function pause() {
  state.paused = true;
  if (state.themeManager) {
    state.themeManager.pause();
  }
  state.soundEffects?.pause();
}

/** Call synchronously in a gesture, before downloads or React updates can consume activation. */
export function unlockAudio() {
  if (state.loaded === "UNSUPPORTED") return;
  const context = getAudioContext();
  if (!context) {
    state.loaded = "UNSUPPORTED";
    return;
  }
  if (context.state !== "running" && context.state !== "closed") {
    // Safari can also report an interrupted context. A later gesture can retry a rejection.
    void context.resume().catch(() => undefined);
  }
}

export function resume() {
  unlockAudio();
  state.paused = false;
  if (state.themeManager) {
    state.themeManager.resume();
  }
  state.soundEffects?.resume();
}

function volume(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function setMusicVolume(value: number) {
  const output = state.musicOutput;
  if (output) {
    output.gain.setValueAtTime(volume(value), output.context.currentTime);
  }
}

export function setSoundEffectsVolume(value: number) {
  state.soundEffects?.setVolume(value);
}

export function playSoundEffect(effect: SoundEffectType) {
  state.soundEffects?.play(effect);
}

export function getAllMusicFiles(): string[] {
  return Object.keys(MUSIC_DEFINITIONS).reduce(
    (acc: string[], themeName: string) => {
      const theme = MUSIC_DEFINITIONS[themeName];
      for (const track of theme.tracks) {
        acc.push(`${theme.directory}${track}`);
      }
      return acc;
    },
    [],
  );
}

/** Decode a track over XHR, which also supports the desktop app's file:// URLs. */
export function loadAudioLocalFile(
  context: AudioContext,
  url: string,
): Promise<AudioNode> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
      if (request.status >= 400) {
        reject(new Error(`Audio request failed: ${request.status}`));
        return;
      }
      void context
        .decodeAudioData(request.response)
        .then((buffer) => resolve(new AudioNode(context, buffer)), reject);
    };
    request.onerror = () => reject(Error("Network error"));
    request.send();
  });
}

/** Load once, with menu playback ready before the expensive gameplay decodes. */
export async function loadAudioFiles(musicVolume = 1, soundEffectsVolume = 1) {
  if (
    state.loaded === "LOADING" ||
    state.loaded === "LOADED" ||
    state.loaded === "UNSUPPORTED"
  )
    return;
  const ac = getAudioContext();
  if (!ac) {
    state.loaded = "UNSUPPORTED";
    return;
  }
  state.loaded = "LOADING";
  if (!state.musicOutput) {
    state.musicOutput = ac.createGain();
    state.musicOutput.connect(ac.destination);
    state.soundEffects = new SoundEffects(ac);
  }
  setMusicVolume(musicVolume);
  setSoundEffectsVolume(soundEffectsVolume);
  if (state.paused) state.soundEffects?.pause();

  try {
    for (const file of getAllMusicFiles()) {
      if (!state.nodes[file]) {
        const node = await loadAudioLocalFile(ac, "audio/" + file);
        node.setOutput(state.musicOutput);
        state.nodes[file] = node;
      }
      if (!state.themeManager) {
        // The short menu loop is first. Keep it available while loading gameplay or retrying.
        state.themeManager = new ThemeManager(ac, state.nodes);
        if (state.paused) state.themeManager.pause();
        state.themeManager.setIntensity(1);
      }
    }
    state.loaded = "LOADED";
    state.themeManager?.setIntensity(playbackIntensity());
  } catch (error) {
    // A download failure is retryable; it is not evidence that this device cannot play audio.
    state.loaded = "ERROR";
    console.warn("Could not load music:", error);
  }
}
