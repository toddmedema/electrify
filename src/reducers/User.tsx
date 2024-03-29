import Redux from 'redux';
import {UserDeltaAction, UserType} from '../Types';

export const initialUser: UserType = {};

export function UserDelta(delta: Partial<UserType>): UserDeltaAction {
  return { type: 'USER_DELTA', delta };
}

export function user(state: UserType = initialUser, action: Redux.Action): UserType {
  switch (action.type) {
    case 'USER_DELTA':
      return {...state, ...(action as UserDeltaAction).delta};
    default:
      return state;
  }
}
