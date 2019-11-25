import {AUTH_SETTINGS as AUTH_SETTINGS_BASE} from 'shared/schema/Constants';

export const AUTH_SETTINGS = {
  ...AUTH_SETTINGS_BASE,
};

export const UNSUPPORTED_BROWSERS = /^(.*amazon silk.*)|(.*(iphone|ipad|ipod|ios) os 9_.*)$/i;

export const URLS = {
  WEBSITE: 'http://expeditiongame.com',
  PRIVACY_POLICY: 'https://expeditiongame.com/privacy',
  QUEST_CREATOR: 'https://quests.expeditiongame.com/?utm_source=app',
  // lowercase to match lowercase platform names
  android: 'https://play.google.com/store/apps/details?id=io.fabricate.expedition',
  ios: 'https://itunes.apple.com/us/app/expedition-roleplaying-card/id1085063478?ls=1&mt=8',
  web: 'http://expeditiongame.com/app',
};

export const INIT_DELAY = {
  LOAD_AUDIO_MILLIS: 2000,
  SILENT_LOGIN_MILLIS: 1000,
};

export const CARD_TRANSITION_ANIMATION_MS = 300;
export const VIBRATION_SHORT_MS = 30; // for navigation / card changes
export const VIBRATION_LONG_MS = 400; // for unique events, like start of the timer
export const NAVIGATION_DEBOUNCE_MS = 600;
export const DOUBLE_TAP_MS = 500; // Maximum ms between tap / clicks to count as a double click
export const AUDIO_COMMAND_DEBOUNCE_MS = 300;
export const MUSIC_INTENSITY_MAX = 36;

/* tslint:disable:object-literal-sort-keys */
export const COMBAT_DIFFICULTY: {[key: string]: any} = {
  EASY: {
    damageMultiplier: 0.7,
    maxRoundDamage: 4,
    surgePeriod: 4,
  },
  NORMAL: {
    damageMultiplier: 1.0,
    maxRoundDamage: 6,
    surgePeriod: 3,
  },
  HARD: {
    damageMultiplier: 1.2,
    maxRoundDamage: 7,
    surgePeriod: 3,
  },
  IMPOSSIBLE: {
    damageMultiplier: 1.4,
    maxRoundDamage: 8,
    surgePeriod: 2,
  },
};
/* tslint:enable:object-literal-sort-keys */

// A slight variation on the cubehelix pattern. This contains 6 categories,
// which is convenient for e.g. displaying 6 distinct character icons.
// https://jiffyclub.github.io/palettable/cubehelix/
// https://github.com/jiffyclub/palettable/blob/29ca166e8eb81797a5417d637f8d0b4901d4dbd0/palettable/cubehelix/cubehelix.py
export const COLORBLIND_FRIENDLY_PALETTE = [
  '#182044',
  '#0e5e4a',
  '#507d23',
  '#be7555',
  '#db8acb',
  '#bfc9fb',
];

export interface MusicDefinition {
  baselineInstruments: string[];
  bpm: number;
  directory: string;
  instruments: string[];
  loopMs: number;
  maxIntensity: number;
  minIntensity: number;
  peakingInstrument: string;
  variants: number;
}

export const MUSIC_DEFINITIONS: {[key: string]: {[key: string]: MusicDefinition}} = {
  combat: {
    heavy: {
      baselineInstruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings'],
      bpm: 140,
      directory: 'combat/heavy/',
      instruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings', 'HighBrass'],
      loopMs: 13712,
      maxIntensity: MUSIC_INTENSITY_MAX,
      minIntensity: 12,
      peakingInstrument: 'HighBrass',
      variants: 6,
    },
    light: {
      // peakingInstrument always at the end
      baselineInstruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings'],
      bpm: 120,
      directory: 'combat/light/',
      instruments: ['Drums', 'LowStrings', 'LowBrass', 'HighStrings', 'HighBrass'],
      loopMs: 8000,
      maxIntensity: 24,
      minIntensity: 0,
      peakingInstrument: 'HighBrass',
      variants: 12,
    },
  },
};

export const MUSIC_FADE_SECONDS = 1.5;

export const NAV_CARDS = ['TUTORIAL_QUESTS'];
export const NAV_CARD_STORAGE_KEY = 'nav_card';
