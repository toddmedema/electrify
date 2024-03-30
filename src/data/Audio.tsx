import {AudioNode} from '../audio/AudioNode';
import {ThemeManager} from '../audio/ThemeManager';
import {MUSIC_DEFINITIONS} from '../Constants';
import {getAudioContext} from '../Globals';
import {AudioLoadingType} from '../Types';
const eachLimit = require('async/eachLimit');

export const state = {
  loaded: 'UNLOADED' as AudioLoadingType,
  themeManager: null as ThemeManager|null,
};

export function pause() {
  if (state.themeManager) {
    state.themeManager.pause();
  }
}

export function resume() {
  if (state.themeManager) {
    state.themeManager.resume();
  }
}

export function getAllMusicFiles(): string[] {
  return Object.keys(MUSIC_DEFINITIONS).reduce((acc: string[], themeName: string) => {
    const theme = MUSIC_DEFINITIONS[themeName];
    for (const track of theme.tracks) {
      acc.push(`${themeName}/${track}`);
    }
    return acc;
  }, []);
}

// can't use Fetch for local files since audio files might come from file://, must use this instead
// TODO: Switch to using promises, or https://tanstack.com/query/latest/docs/framework/react/overview
export function loadAudioLocalFile(context: AudioContext, url: string, callback: (err: Error|null, buffer: AudioNode|null) => void) {
  const request = new XMLHttpRequest();
  request.open('GET', url, true);
  request.responseType = 'arraybuffer';
  request.onload = () => {
    context.decodeAudioData(request.response, (buffer: AudioBuffer) => {
      return callback(null, new AudioNode(context, buffer));
    }, (err: Error) => {
      return callback(err, null);
    });
  };
  request.onerror = () => {
    return callback(Error('Network error'), null);
  };
  request.send();
}

export function loadAudioFiles() {
  const ac = getAudioContext();
  if (!ac) {
    return;
  }

  state.loaded = 'LOADING';
  const musicFiles = getAllMusicFiles();
  const audioNodes: {[key: string]: AudioNode} = {};
  eachLimit(musicFiles, 4, (file: string, callback: (err?: Error) => void) => {
    loadAudioLocalFile(ac, 'audio/' + file + '.mp3', (err: Error|null, buffer: AudioNode|null) => {
      if (err || buffer == null) {
        err = err || new Error('buffer is null');
        console.error('Error loading audio file ' + file + ': ' + err.toString());
        return callback(err);
      }
      audioNodes[file] = buffer;
      return callback();
    });
  }, (err?: Error) => {
    if (err) {
      state.loaded = 'ERROR';
      return;
    }
    state.themeManager = new ThemeManager(audioNodes);
    state.loaded = 'LOADED';
    state.themeManager.setIntensity(1);
  });
}
