import Redux from 'redux';
import {getStorageBoolean, getStorageBooleanOrUndefined, setStorageKeyValue} from '../LocalStorage';
import {ChangeSettingsAction, SettingsType} from '../Types';

export const initialSettings: SettingsType = {
  audioEnabled: getStorageBooleanOrUndefined('audioEnabled'),
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
