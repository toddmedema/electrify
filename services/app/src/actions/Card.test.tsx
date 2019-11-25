import {setNavigator} from '../Globals';
import {Action} from '../Testing';
import {toCard} from './Card';
import {AUTH_SETTINGS} from '../Constants';
import {setStorageKeyValue} from '../LocalStorage';
import {initialSettings} from '../reducers/Settings';

const fetchMock = require('fetch-mock');

describe('Card action', () => {
  describe('toCard', () => {
    const navigator = {vibrate: () => { /* mock */ }};
    setNavigator(navigator);

    test('causes vibration if vibration enabled', () => {
      spyOn(navigator, 'vibrate');
      Action(toCard, {settings: {vibration: true}}).execute({name: 'QUEST_CARD'});
      expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    });

    test('does not vibrate if vibration not enabled', () => {
      spyOn(navigator, 'vibrate');
      Action(toCard, {settings: {vibration: false}}).execute({name: 'QUEST_CARD'});
      expect(navigator.vibrate).toHaveBeenCalledTimes(0);
    });

    test('dispatches a NAVIGATE action', () => {
      Action(toCard).expect({name: 'QUEST_CARD'}).toDispatch(jasmine.objectContaining({type: 'NAVIGATE'}));
    });
  });
});
