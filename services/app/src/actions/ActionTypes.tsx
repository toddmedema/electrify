import Redux from 'redux';
import {
  AudioDataState,
  AudioState,
  CardState,
  SettingsType,
} from '../reducers/StateTypes';

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

export interface ChangeSettingsAction extends Redux.Action {
  type: 'CHANGE_SETTINGS';
  settings: Partial<SettingsType>;
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
