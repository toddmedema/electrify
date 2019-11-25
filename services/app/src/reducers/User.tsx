import Redux from 'redux';
import {loggedOutUser} from 'shared/auth/UserState';
import {UserLoginAction} from '../actions/ActionTypes';
import {UserState} from './StateTypes';

export function user(state: UserState = loggedOutUser, action: Redux.Action): UserState {
  switch (action.type) {
    case 'USER_LOGIN':
      return (action as UserLoginAction).user;
    default:
      return state;
  }
}
