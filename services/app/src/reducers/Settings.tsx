import Redux from 'redux';
import {NODE_ENV} from 'shared/schema/Constants';
import {getStorageBoolean, getStorageString, setStorageKeyValue} from '../LocalStorage';
import {ChangeSettingsAction, DifficultyType, SettingsType} from '../Types';

export const initialSettings: SettingsType = {
  audioEnabled: getStorageBoolean('audioEnabled', true),
  difficulty: getStorageString('difficulty', 'NORMAL') as DifficultyType,
  experimental: getStorageBoolean('experimental', false) || NODE_ENV === 'dev',
  showHelp: getStorageBoolean('showHelp', true),
  vibration: getStorageBoolean('vibration', true),
};

// Settings are game-independent settings that persist across app opens (such as volume)
// Things that don't persist are part of UI
// Things that do persist, but are per-game, should be part of gameState
export function settings(state: SettingsType = initialSettings, action: Redux.Action): SettingsType {
  switch (action.type) {
    case 'CHANGE_SETTINGS':
      const csa = action as ChangeSettingsAction;
      const changes = csa.settings || {};

      // Update stored values
      Object.keys(changes).forEach((key: string) => {
        setStorageKeyValue(key, changes[key]);
      });
      return {...state, ...changes};
    default:
      return state;
  }
}
