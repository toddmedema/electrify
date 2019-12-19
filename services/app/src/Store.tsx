import Redux, {applyMiddleware, createStore} from 'redux';
// import {composeWithDevTools} from 'redux-devtools-extension';
import thunk from 'redux-thunk';
import Store from './reducers/CombinedReducers';
import {AppStateType} from './Types';

declare const require: any;
declare const module: any;

let store: Redux.Store<AppStateType>;

export function installStore(createdStore: Redux.Store<AppStateType>) {
  store = createdStore;
}

export function createAppStore() {
  // const composeEnhancers = composeWithDevTools({});
  installStore(createStore(Store, applyMiddleware(thunk)));

  if (module && module.hot) {
    module.hot.accept('./reducers/CombinedReducers', () => {
      const updated = require('./reducers/CombinedReducers').default;
      store.replaceReducer(updated);
    });
  }

  store.dispatch({type: 'GAME_TICK'});
}

export function getStore() {
  if (store !== undefined) {
    return store;
  }
  createAppStore();
  return store;
}
