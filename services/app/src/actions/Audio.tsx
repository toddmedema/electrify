import * as Redux from 'redux';
import {AudioNode} from '../audio/AudioNode';
import {ThemeManager} from '../audio/ThemeManager';
import {MUSIC_DEFINITIONS} from '../Constants';
import {getAudioContext} from '../Globals';
import {AudioDataType, AudioType} from '../Types';
import {AudioDataSetAction, AudioSetAction} from '../Types';
const eachLimit = require('async/eachLimit');

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
// TODO: Switch to using promises
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

function audioDataSet(data: Partial<AudioDataType>): AudioDataSetAction {
  return {type: 'AUDIO_DATA_SET', data};
}

export function loadAudioFiles() {
  return (dispatch: Redux.Dispatch<any>): any => {
    const ac = getAudioContext();
    if (!ac) {
      return;
    }

    dispatch(audioSet({loaded: 'LOADING'}));
    const musicFiles = getAllMusicFiles();
    const audioNodes: {[key: string]: AudioNode} = {};
    eachLimit(musicFiles, 4, (file: string, callback: (err?: Error) => void) => {
      loadAudioLocalFile(ac, 'audio/' + file + '.mp3', (err: Error|null, ns: AudioNode) => {
        if (err) {
          console.error('Error loading audio file ' + file + ': ' + err.toString());
          return callback(err);
        }
        audioNodes[file] = ns;
        return callback();
      });
    }, (err?: Error) => {
      if (err) {
        dispatch(audioSet({loaded: 'ERROR'}));
        return;
      }
      dispatch(audioSet({loaded: 'LOADED'}));
      const themeManager = new ThemeManager(audioNodes);
      dispatch(audioDataSet({audioNodes, themeManager}));
      dispatch(audioSet({intensity: 1, paused: false})); // start playing the intro
    });
  };
}

export function audioSet(delta: Partial<AudioType>): AudioSetAction {
  return {
    delta: {
      sfx: null, // default to not playing a sfx
      timestamp: Date.now(),
      ...delta,
    },
    type: 'AUDIO_SET',
  } as AudioSetAction;
}
