import {Checkbox, IconButton, Toolbar, Typography} from '@material-ui/core';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import * as React from 'react';
import {VERSION} from 'shared/schema/Constants';
import {SettingsType} from '../../Types';

export interface StateProps {
  settings: SettingsType;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onExperimentalChange: (change: boolean) => void;
  onBack: () => void;
  onShowHelpChange: (change: boolean) => void;
  onVibrationChange: (change: boolean) => void;
}

export interface Props extends StateProps, DispatchProps {}

const Settings = (props: Props): JSX.Element => {
  // TODO: enable / disable music, font size, auto-pause while looking at build options, keyboard shortcuts, ...?
  // const fontSizeIdx = fontSizeValues.indexOf(props.settings.fontSize);

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

  // Getting keyboard shortcut map: https://www.npmjs.com/package/react-hotkeys#displaying-a-list-of-available-hot-keys

  return (
    <div className="flexContainer" id="gameCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6">Settings</Typography>
        </Toolbar>
      </div>
      <div style={{textAlign: 'center', margin: '20px 0', lineHeight: '30px'}}>
        <Checkbox color="primary" id="sound" checked={props.settings.audioEnabled} onChange={(e: any) => props.onAudioChange(e.target.checked)}/>
        {(props.settings.audioEnabled) ? 'Music and sound effects enabled.' : 'Music and sound effects disabled.'}
        <Typography className="version">Electrify App v{VERSION}</Typography>
      </div>
    </div>
  );
};

export default Settings;
