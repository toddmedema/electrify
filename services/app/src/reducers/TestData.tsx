import {DifficultyType, SettingsType} from '../Types';

export const settings: {[k: string]: SettingsType} = {
  basic: {
    audioEnabled: false,
    difficulty: 'NORMAL' as DifficultyType,
    experimental: false,
    showHelp: true,
    vibration: true,
  },
};
