import Redux from 'redux'
import {NavigateAction} from './ActionTypes'
import {PageType, TransitionType} from '../reducers/StateTypes'

export function toHome() {
  return (dispatch: Redux.Dispatch<any>): any => {
console.log('TODO prompt user if they want to return home, then return home if true');
  };
}

export function toPage(page: PageType, transition?: TransitionType) {
  return (dispatch: Redux.Dispatch<any>): any => {
    dispatch({type: 'NAVIGATE', page, transition} as NavigateAction);
  }
}

