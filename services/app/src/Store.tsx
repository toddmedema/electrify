import Redux, {createStore} from 'redux';
import {composeWithDevTools} from 'redux-devtools-extension';
import Store from './reducers/CombinedReducers';
import {AppState} from './Types';

declare const require: any;
declare const module: any;

let store: Redux.Store<AppState>;

export function installStore(createdStore: Redux.Store<AppState>) {
  store = createdStore;
}

export function createAppStore() {
  const composeEnhancers = composeWithDevTools({});
  installStore(createStore(Store,  composeEnhancers()));

  if (module && module.hot) {
    module.hot.accept('./reducers/CombinedReducers', () => {
      const updated = require('./reducers/CombinedReducers').default;
      store.replaceReducer(updated);
    });
  }
}

export function getStore() {
  if (store !== undefined) {
    return store;
  }
  createAppStore();
  return store;
}
