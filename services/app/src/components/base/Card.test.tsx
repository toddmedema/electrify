import {mount, mountRoot, unmountAll} from 'app/Testing';
import * as React from 'react';
import Card, {Props} from './Card';
import {initialSettings} from 'app/reducers/Settings';

describe('Card', () => {
  afterEach(unmountAll);

  const EXTRA_STATE = {settings: initialSettings};

  function setup(overrides?: Partial<Props>) {
    const props: Props = {
      ...overrides,
    };
    const wrapper = mount(<Card {...props}/>, EXTRA_STATE);
    return {props, wrapper};
  }

  test('displays card title', () => {
    const {wrapper} = setup({title: 'title'});
    expect(wrapper.find('.title').text()).toBe('title');
  });

  test.skip('opens ios/android-specific rating pages on menu -> rate', () => { /* TODO */ });

  test.skip('prompts user to confirm if they try to go home while in a quest', () => { /* TODO */ });

  test.skip('cancelling a go home while in quest does not trigger a go home', () => { /* TODO */ });

  test('always closes top-right menu when a menu button is clicked', () => {
    // We're updating mid-test, so have to use the root element here.
    const root = mountRoot(<Card/>, EXTRA_STATE);
    root.find('IconButton#menuButton').simulate('click', {currentTarget: root.find('IconButton#menuButton')});
    root.update();
    expect(root.find('Menu').prop('open')).toEqual(true);
    root.find('MenuItem#homeButton').simulate('click');
    root.update();
    expect(root.find('Menu').prop('open')).toEqual(false);
  });

  test.skip('storage errors are shown in snackbar', () => { /* TODO */ });
});
