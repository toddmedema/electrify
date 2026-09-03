import { AudioNode } from "../audio/AudioNode";
import { ThemeManager } from "../audio/ThemeManager";
import { SoundEffects, SoundEffectType } from "../audio/SoundEffects";
import { MUSIC_DEFINITIONS } from "../Constants";
import { getAudioContext } from "../Globals";
import { AudioLoadingType } from "../Types";

export const state = {
  loaded: "UNLOADED" as AudioLoadingType,
  themeManager: null as ThemeManager | null,
  soundEffects: null as SoundEffects | null,
  musicOutput: null as GainNode | null,
  paused: false,
};

export function pause() {
  state.paused = true;
  if (state.themeManager) {
    state.themeManager.pause();
  }
  state.soundEffects?.pause();
}

export function resume() {
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
        acc.push(`${themeName}/${track}`);
      }
      return acc;
    },
    [],
  );
}

// can't use Fetch for local files since audio files might come from file://, must use this instead
// TODO: Switch to using promises, or https://tanstack.com/query/latest/docs/framework/react/overview
export function loadAudioLocalFile(
  context: AudioContext,
  url: string,
): Promise<AudioNode> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
      context.decodeAudioData(
        request.response,
        (buffer: AudioBuffer) => resolve(new AudioNode(context, buffer)),
        reject,
      );
    };
    request.onerror = () => reject(Error("Network error"));
    request.send();
  });
}

async function eachWithLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let stopped = false;
  async function runWorker() {
    while (!stopped && nextIndex < items.length) {
      const item = items[nextIndex++];
      try {
        await worker(item);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runWorker),
  );
}

export function loadAudioFiles(musicVolume = 1, soundEffectsVolume = 1) {
  const ac = getAudioContext();
  if (!ac) {
    return;
  }

  state.loaded = "LOADING";
  const musicOutput = ac.createGain();
  musicOutput.connect(ac.destination);
  state.musicOutput = musicOutput;
  state.soundEffects = new SoundEffects(ac);
  setMusicVolume(musicVolume);
  setSoundEffectsVolume(soundEffectsVolume);
  if (state.paused) {
    state.soundEffects.pause();
  }
  const musicFiles = getAllMusicFiles();
  const audioNodes: { [key: string]: AudioNode } = {};
  eachWithLimit(musicFiles, 4, async (file) => {
    try {
      const buffer = await loadAudioLocalFile(ac, "audio/" + file + ".mp3");
      // Every track routes through one gain node, so changing music volume does not disturb
      // ThemeManager's per-track fades or restart the six-minute loop.
      buffer.setOutput(musicOutput);
      audioNodes[file] = buffer;
    } catch (error) {
      console.error("Error loading audio file " + file + ": " + String(error));
      throw error;
    }
  })
    .then(() => {
      state.themeManager = new ThemeManager(ac, audioNodes);
      state.loaded = "LOADED";
      if (state.paused) {
        state.themeManager.pause();
      }
      state.themeManager.setIntensity(1);
    })
    .catch(() => {
      state.loaded = "ERROR";
    });
}
