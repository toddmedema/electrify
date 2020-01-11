import {Button} from '@material-ui/core';
// import Checkbox from '@material-ui/core/Checkbox';
import * as React from 'react';
import {VERSION} from 'shared/schema/Constants';
import {DifficultyType, SettingsType} from '../../Types';

export interface StateProps {
  settings: SettingsType;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onDifficultyDelta: (difficulty: DifficultyType, i: number) => void;
  onExperimentalChange: (change: boolean) => void;
  onMainMenu: () => void;
  onShowHelpChange: (change: boolean) => void;
  onVibrationChange: (change: boolean) => void;
}

export interface Props extends StateProps, DispatchProps {}

const Settings = (props: Props): JSX.Element => {
  // const fontSizeIdx = fontSizeValues.indexOf(props.settings.fontSize);

  // <Checkbox id="sound" label="Sound" checked={props.settings.audioEnabled} onChange={(e) => props.onAudioChange(e.target.checked)}>
  //   {(props.settings.audioEnabled) ? 'Music and sound effects enabled.' : 'Music and sound effects disabled.'}
  // </Checkbox>

  // <Checkbox id="help" label="Show Help" value={props.settings.showHelp} onChange={props.onShowHelpChange}>
  //   {(props.settings.showHelp) ? 'Setup and combat hints are shown.' : 'Setup and combat hints are hidden.'}
  // </Checkbox>

  // <Checkbox id="vibration" label="Vibration" value={props.settings.vibration} onChange={props.onVibrationChange}>
  //   {(props.settings.vibration) ? 'Vibrate on touch.' : 'Do not vibrate.'}
  // </Checkbox>

  // <Picker label="Font Size" value={fontSizeValues[fontSizeIdx]} onDelta={(i: number) => props.onFontSizeDelta(fontSizeIdx, i)}>
  //   Takes effect once you leave settings.
  // </Picker>

  // <Checkbox id="experimental" label="Experimental" value={props.settings.experimental} onChange={props.onExperimentalChange}>
  //   {(props.settings.experimental) ? 'Experimental features are currently enabled.' : 'Experimental features are currently disabled.'}
  // </Checkbox>

  return (
    <div>
      <Button variant="contained" color="primary" onClick={props.onMainMenu}>Return to main menu</Button>
      TODO: enable / disable music, font size, auto-pause while looking at build options, ...?
      <div className="version">Electrify App v{VERSION}</div>
    </div>
  );
};

export default Settings;
