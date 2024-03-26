import Redux, {applyMiddleware, compose, createStore} from 'redux';
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
  // For redux dev tool browser extension https://github.com/reduxjs/redux-devtools/tree/main/extension#installation
  const composeEnhancers = (window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
  const enhancer = composeEnhancers(applyMiddleware(thunk));
  installStore(createStore(Store, enhancer));

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
