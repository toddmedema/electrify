import * as React from "react";
import {
  Checkbox,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Toolbar,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { SettingsType, UnitSystemType } from "../../Types";
import { UNIT_SYSTEMS, UNIT_SYSTEM_LABELS } from "../../helpers/Units";
import KeyboardShortcuts from "../base/KeyboardShortcuts";
import packageJson from "../../../package.json";

export interface StateProps {
  settings: SettingsType;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onUnitsChange: (change: UnitSystemType) => void;
  onBack: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function Settings(props: Props): React.JSX.Element {
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

  return (
    <div className="flexContainer" id="gameCard">
      <div id="topbar">
        <Toolbar>
          <IconButton
            onClick={props.onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h6">Settings</Typography>
        </Toolbar>
      </div>
      <div
        style={{ textAlign: "center", margin: "20px 0", lineHeight: "30px" }}
      >
        <Checkbox
          color="primary"
          id="sound"
          checked={props.settings.audioEnabled}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            props.onAudioChange(e.target.checked)
          }
        />
        {props.settings.audioEnabled
          ? "Music and sound effects enabled."
          : "Music and sound effects disabled."}
        <Typography variant="h6" style={{ marginTop: 24 }}>
          Units
        </Typography>
        <Select
          id="units"
          value={props.settings.units}
          onChange={(e: SelectChangeEvent<UnitSystemType>) =>
            props.onUnitsChange(e.target.value as UnitSystemType)
          }
        >
          {UNIT_SYSTEMS.map((system: UnitSystemType) => (
            <MenuItem value={system} key={system}>
              {UNIT_SYSTEM_LABELS[system]}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="body2" color="textSecondary">
          {props.settings.units === "imperial"
            ? "Temperatures in °F, wind in mph, emissions in pounds and tons."
            : "Temperatures in °C, wind in km/h, emissions in kilograms and tonnes."}
        </Typography>
        <Typography variant="h6" style={{ marginTop: 24 }}>
          Keyboard Shortcuts
        </Typography>
        <KeyboardShortcuts />
        <Typography className="version">
          Electrify App v{packageJson.version}
        </Typography>
        <Typography className="github">
          <a
            href="https://github.com/toddmedema/electrify"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </Typography>
      </div>
    </div>
  );
}
