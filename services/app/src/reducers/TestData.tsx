import {DifficultyType, FontSizeType, SettingsType} from './StateTypes';

export const Settings: {[k: string]: SettingsType} = {
  basic: {
    audioEnabled: false,
    difficulty: 'NORMAL' as DifficultyType,
    experimental: false,
    fontSize: 'NORMAL' as FontSizeType,
    showHelp: true,
    vibration: true,
  },
};
