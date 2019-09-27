import Redux from 'redux'
import {GeneratorId, PageType, TransitionType} from '../reducers/StateTypes'

export interface BuildGeneratorAction extends Redux.Action {
  type: 'BUILD_GENERATOR';
  id: GeneratorId;
}

export interface NavigateAction extends Redux.Action {
  type: 'NAVIGATE';
  page: PageType;
  transition?: TransitionType;
}

export interface SnackbarOpenAction extends Redux.Action {
  type: 'SNACKBAR_OPEN';
  message?: string;
  timeout?: number;
}

export interface SnackbarCloseAction extends Redux.Action {
  type: 'SNACKBAR_CLOSE';
}
