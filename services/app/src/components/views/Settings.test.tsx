import {mount, unmountAll} from 'app/Testing';
import * as React from 'react';
import Settings, { Props } from './Settings';
import {initialSettings} from '../../reducers/Settings';

describe('Settings', () => {
  afterEach(unmountAll);

  function setup(overrides?: Partial<Props>) {
    const props: Props = {
      settings: initialSettings,
      onAudioChange: jasmine.createSpy('onAudioChange'),
      onDifficultyDelta: jasmine.createSpy('onDifficultyDelta'),
      onExperimentalChange: jasmine.createSpy('onExperimentalChange'),
      onFontSizeDelta: jasmine.createSpy('onFontSizeDelta'),
      onShowHelpChange: jasmine.createSpy('onShowHelpChange'),
      onVibrationChange: jasmine.createSpy('onVibrationChange'),
      ...overrides,
    };
    const elem = mount(<Settings {...props} />);
    return {elem, props};
  }

  test.skip('displays with initial settings', () => { /* TODO */ });
  test.skip('displays with timerSeconds = null', () => { /* TODO */ });

  test('changes sound', () => {
    const {elem, props} = setup();
    elem.find('Checkbox#sound').prop('onChange')(true);
    expect(props.onAudioChange).toHaveBeenCalledWith(true);
  });
  test('changes help', () => {
    const {elem, props} = setup();
    elem.find('Checkbox#help').prop('onChange')(true);
    expect(props.onShowHelpChange).toHaveBeenCalledWith(true);
  });
  test('changes vibration', () => {
    const {elem, props} = setup();
    elem.find('Checkbox#vibration').prop('onChange')(true);
    expect(props.onVibrationChange).toHaveBeenCalledWith(true);
  });
  test('changes experimental', () => {
    const {elem, props} = setup();
    elem.find('Checkbox#experimental').prop('onChange')(true);
    expect(props.onExperimentalChange).toHaveBeenCalledWith(true);
  });
});
