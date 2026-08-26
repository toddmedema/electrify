import * as React from "react";
import {
  Button,
  Checkbox,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Toolbar,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { SettingsType, ThemeChoiceType, UnitSystemType } from "../../Types";
import { UNIT_SYSTEMS, UNIT_SYSTEM_LABELS } from "../../helpers/Units";
import { THEME_CHOICES, THEME_LABELS } from "../../Theme";
import KeyboardShortcuts from "../base/KeyboardShortcuts";
import packageJson from "../../../package.json";

export interface StateProps {
  settings: SettingsType;
  // What the saved game is called, or undefined when there's nothing to export
  savedGame?: string;
  loggedIn: boolean;
  // The leaderboard name, when one has been claimed
  displayName?: string;
}

export interface DispatchProps {
  onLogin: () => void;
  onLogout: () => void;
  onChangeName: () => void;
  onAudioChange: (change: boolean) => void;
  onUnitsChange: (change: UnitSystemType) => void;
  onThemeChange: (change: ThemeChoiceType) => void;
  onExportSave: () => void;
  onImportSave: (file: File) => void;
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

  // The file picker is driven by the Import button rather than wrapping it, so that both buttons
  // are plainly buttons and the disabled Export one behaves like one
  const fileInput = React.useRef<HTMLInputElement>(null);
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    // Cleared so that picking the same file again still counts as a change, which is what a
    // player who fixed a bad file by hand and came back would expect
    e.target.value = "";
    if (file) {
      props.onImportSave(file);
    }
  };

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
          Account
        </Typography>
        {props.loggedIn ? (
          <div>
            <Typography variant="body2" color="textSecondary">
              {props.displayName
                ? `On the leaderboard as ${props.displayName}.`
                : "You're logged in, but haven't picked a leaderboard name yet."}
            </Typography>
            <Button
              variant="outlined"
              color="primary"
              onClick={props.onChangeName}
              style={{ margin: "0 6px" }}
            >
              {props.displayName ? "Change name" : "Pick a name"}
            </Button>
            <Button
              variant="outlined"
              color="primary"
              onClick={props.onLogout}
              style={{ margin: "0 6px" }}
            >
              Log out
            </Button>
          </div>
        ) : (
          <div>
            <Button
              variant="outlined"
              color="primary"
              onClick={props.onLogin}
              style={{ margin: "0 6px" }}
            >
              Log in
            </Button>
            <Typography variant="body2" color="textSecondary">
              Log in to put your name on the global high score board.
            </Typography>
          </div>
        )}
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
          Appearance
        </Typography>
        <Select
          id="theme"
          value={props.settings.theme}
          onChange={(e: SelectChangeEvent<ThemeChoiceType>) =>
            props.onThemeChange(e.target.value as ThemeChoiceType)
          }
        >
          {THEME_CHOICES.map((choice: ThemeChoiceType) => (
            <MenuItem value={choice} key={choice}>
              {THEME_LABELS[choice]}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="body2" color="textSecondary">
          {props.settings.theme === "system"
            ? "Follows whatever your device is set to, and changes with it."
            : "Sessions run long; the charts are drawn for both."}
        </Typography>
        <Typography variant="h6" style={{ marginTop: 24 }}>
          Saved Game
        </Typography>
        <div>
          <Button
            variant="outlined"
            color="primary"
            disabled={!props.savedGame}
            onClick={props.onExportSave}
            style={{ margin: "0 6px" }}
          >
            Export
          </Button>
          <Button
            variant="outlined"
            color="primary"
            onClick={() => fileInput.current?.click()}
            style={{ margin: "0 6px" }}
          >
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            aria-label="Save game file"
            onChange={onFileChosen}
          />
        </div>
        <Typography variant="body2" color="textSecondary">
          {props.savedGame
            ? `Export downloads your saved game (${props.savedGame}) to keep or share. Importing one replaces it.`
            : "You need a game in progress to export one - start a game, then come back here. You can still import a save that someone shared with you."}
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
