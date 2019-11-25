import Redux from 'redux';
import {
  AudioDataState,
  AudioState,
  CardName,
  CardState,
  ServerStatusState,
  SettingsType,
  UserState,
} from '../reducers/StateTypes';

export interface FetchServerStatusResponse {
  message: string;
  link: string;
  versions: {
    android: string;
    ios: string;
    web: string;
  };
}

export interface ServerStatusSetAction extends Redux.Action {
  type: 'SERVER_STATUS_SET';
  delta: Partial<ServerStatusState>;
}

export interface AudioSetAction extends Redux.Action {
  type: 'AUDIO_SET';
  delta: Partial<AudioState>;
}

export interface AudioDataSetAction extends Redux.Action {
  type: 'AUDIO_DATA_SET';
  data: Partial<AudioDataState>;
}

export interface NavigateAction extends Redux.Action {
  type: 'NAVIGATE';
  to: CardState;
  dontUpdateUrl: boolean;
}

export interface ReturnAction extends Redux.Action {
  type: 'RETURN';
  matchFn?: (c: CardName) => boolean;
  before: boolean;
}

export interface ChangeSettingsAction extends Redux.Action {
  type: 'CHANGE_SETTINGS';
  settings: Partial<SettingsType>;
}

export interface UserLoginAction extends Redux.Action {
  type: 'USER_LOGIN';
  user: UserState;
}

export interface SnackbarOpenAction extends Redux.Action {
  type: 'SNACKBAR_OPEN';
  message: string;
  action?: (e: any) => void;
  actionLabel?: string;
}

export interface SnackbarCloseAction extends Redux.Action {
  type: 'SNACKBAR_CLOSE';
}
