import Button from '@material-ui/core/Button';
// import Checkbox from '@material-ui/core/Checkbox';
import * as React from 'react';
import {VERSION} from 'shared/schema/Constants';
import {DifficultyType, FontSizeType, SettingsType} from '../../Types';

export interface StateProps {
  settings: SettingsType;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onDifficultyDelta: (difficulty: DifficultyType, i: number) => void;
  onExperimentalChange: (change: boolean) => void;
  onFontSizeDelta: (idx: number, delta: number) => void;
  onMainMenu: () => void;
  onShowHelpChange: (change: boolean) => void;
  onVibrationChange: (change: boolean) => void;
}

export interface Props extends StateProps, DispatchProps {}

// For all cycles, going to the right = harder, left = easier
// const difficultyText: { [v: string]: any } = [
//   {title: 'Story', text: 'You\'re here for the story. Enemies go easy on you.'},
//   {title: 'Normal', text: 'As it was meant to be played. Adventurers start here!'},
//   {title: 'Hard', text: 'Enemies are relentless; a true challenge for seasoned adventurers only.'},
//   {title: 'Impossible', text: 'You will almost surely die, so make your death a glorious one!'},
// ];
// const difficultyValues: string[] = ['EASY', 'NORMAL', 'HARD', 'IMPOSSIBLE'];

export const fontSizeValues: FontSizeType[] = ['SMALL', 'NORMAL', 'LARGE'];

const Settings = (props: Props): JSX.Element => {
  // const difficultyIdx = difficultyValues.indexOf(props.settings.difficulty);
  // const fontSizeIdx = fontSizeValues.indexOf(props.settings.fontSize);
  // <Picker label="Difficulty" value={difficultyText[difficultyIdx].title} onDelta={(i: number) => props.onDifficultyDelta(props.settings.difficulty, i)}>
  //   {difficultyText[difficultyIdx].text}
  // </Picker>

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
      <div className="version">Expedition App v{VERSION}</div>
    </div>
  );
};

export default Settings;
