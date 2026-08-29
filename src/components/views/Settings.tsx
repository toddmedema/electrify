import * as React from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { SettingsType, ThemeChoiceType, UnitSystemType } from "../../Types";
import { UNIT_SYSTEMS, UNIT_SYSTEM_LABELS } from "../../helpers/Units";
import { THEME_CHOICES, THEME_LABELS } from "../../Theme";
import KeyboardShortcuts from "../base/KeyboardShortcuts";
import InstallAppButton, { useIsInstalledApp } from "../base/InstallAppButton";
import packageJson from "../../../package.json";
import { clearAppCache } from "../../helpers/Cache";

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
  onMusicVolumeChange: (change: number) => void;
  onSoundEffectsVolumeChange: (change: number) => void;
  onUnitsChange: (change: UnitSystemType) => void;
  onThemeChange: (change: ThemeChoiceType) => void;
  onExportSave: () => void;
  onImportSave: (file: File) => void;
  onBack: () => void;
}

export interface Props extends StateProps, DispatchProps {}

interface SettingsSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

function SettingsSection({
  id,
  title,
  children,
}: SettingsSectionProps): React.JSX.Element {
  return (
    <Box
      component="section"
      aria-labelledby={id}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "88px minmax(0, 1fr)",
          sm: "160px minmax(0, 1fr)",
        },
        gap: { xs: 1.5, sm: 2 },
        alignItems: "start",
        py: 1.25,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography
        id={id}
        component="h2"
        variant="subtitle2"
        sx={{ pt: 0.75, fontWeight: 700 }}
      >
        {title}
      </Typography>
      <Stack spacing={0.75} sx={{ alignItems: "flex-start", minWidth: 0 }}>
        {children}
      </Stack>
    </Box>
  );
}

export default function Settings(props: Props): React.JSX.Element {
  const installedApp = useIsInstalledApp();
  // TODO: font size, auto-pause while looking at build options, keyboard shortcuts, ...?
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
          <Typography component="h1" variant="h6">
            Settings
          </Typography>
        </Toolbar>
      </div>
      <Box
        className="scrollable"
        sx={{
          width: "100%",
          maxWidth: 720,
          mx: "auto",
          px: { xs: 2, sm: 3 },
          py: 0.5,
          boxSizing: "border-box",
          overflowY: "auto",
        }}
      >
        <Stack spacing={0}>
          <SettingsSection id="sound-settings" title="Sound">
            <FormControlLabel
              control={
                <Checkbox
                  color="primary"
                  id="sound"
                  checked={!!props.settings.audioEnabled}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    props.onAudioChange(e.target.checked)
                  }
                />
              }
              label={
                props.settings.audioEnabled
                  ? "Music and sound effects enabled"
                  : "Music and sound effects disabled"
              }
            />
            <Box sx={{ width: "100%", maxWidth: 360, px: 1 }}>
              <Typography id="music-volume-label" variant="body2">
                Music volume: {Math.round(props.settings.musicVolume * 100)}%
              </Typography>
              <Slider
                aria-labelledby="music-volume-label"
                value={Math.round(props.settings.musicVolume * 100)}
                disabled={!props.settings.audioEnabled}
                onChange={(_e: Event, value: number | number[]) =>
                  props.onMusicVolumeChange((value as number) / 100)
                }
              />
              <Typography id="effects-volume-label" variant="body2">
                Sound effects volume:{" "}
                {Math.round(props.settings.soundEffectsVolume * 100)}%
              </Typography>
              <Slider
                aria-labelledby="effects-volume-label"
                value={Math.round(props.settings.soundEffectsVolume * 100)}
                disabled={!props.settings.audioEnabled}
                onChange={(_e: Event, value: number | number[]) =>
                  props.onSoundEffectsVolumeChange((value as number) / 100)
                }
              />
            </Box>
          </SettingsSection>

          <SettingsSection id="account-settings" title="Account">
            <Typography variant="body2" color="textSecondary">
              {props.loggedIn
                ? props.displayName
                  ? `On the leaderboard as ${props.displayName}.`
                  : "You're logged in, but haven't picked a leaderboard name yet."
                : "Optional: sign in with Google to put a public display name and score on the leaderboard."}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: "wrap" }}
            >
              {props.loggedIn ? (
                <>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={props.onChangeName}
                  >
                    {props.displayName ? "Change name" : "Pick a name"}
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={props.onLogout}
                  >
                    Log out
                  </Button>
                </>
              ) : (
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={props.onLogin}
                >
                  Sign in with Google
                </Button>
              )}
            </Stack>
          </SettingsSection>

          <SettingsSection id="units-settings" title="Units">
            <FormControl fullWidth>
              <InputLabel id="units-label">Measurement system</InputLabel>
              <Select
                labelId="units-label"
                id="units"
                label="Measurement system"
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
            </FormControl>
            <Typography variant="body2" color="textSecondary">
              {props.settings.units === "imperial"
                ? "Temperatures in °F, wind in mph, emissions in pounds and tons."
                : "Temperatures in °C, wind in km/h, emissions in kilograms and tonnes."}
            </Typography>
          </SettingsSection>

          <SettingsSection id="appearance-settings" title="Appearance">
            <FormControl fullWidth>
              <InputLabel id="theme-label">Color theme</InputLabel>
              <Select
                labelId="theme-label"
                id="theme"
                label="Color theme"
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
            </FormControl>
            <Typography variant="body2" color="textSecondary">
              {props.settings.theme === "system"
                ? "Follows whatever your device is set to, and changes with it."
                : "Sessions run long; the charts are drawn for both."}
            </Typography>
          </SettingsSection>

          {!installedApp && (
            <SettingsSection id="app-settings" title="App">
              <InstallAppButton />
              <Typography variant="body2" color="textSecondary">
                Install availability depends on your browser. Once installed,
                Electrify opens like an app and caches every location for
                offline play.
              </Typography>
            </SettingsSection>
          )}

          <SettingsSection id="saved-game-settings" title="Saved Game">
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: "wrap" }}
            >
              <Button
                variant="outlined"
                color="primary"
                disabled={!props.savedGame}
                onClick={props.onExportSave}
              >
                Export
              </Button>
              <Button
                variant="outlined"
                color="primary"
                onClick={() => fileInput.current?.click()}
              >
                Import
              </Button>
            </Stack>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              aria-label="Save game file"
              onChange={onFileChosen}
            />
            <Typography variant="body2" color="textSecondary">
              {props.savedGame
                ? `Export downloads your saved game (${props.savedGame}) to keep or share. Importing one replaces it.`
                : "You need a game in progress to export one - start a game, then come back here. You can still import a save that someone shared with you."}
            </Typography>
          </SettingsSection>

          <SettingsSection id="keyboard-settings" title="Keyboard Shortcuts">
            <KeyboardShortcuts />
          </SettingsSection>

          <Stack
            component="footer"
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ justifyContent: "center", flexWrap: "wrap", py: 1.5 }}
          >
            <Typography variant="caption">
              Electrify App v{packageJson.version}
            </Typography>
            <Typography variant="caption">
              <a
                href="https://github.com/toddmedema/electrify"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </Typography>
            <Typography variant="caption">
              <a href="/privacy.html">Privacy</a>
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={() => void clearAppCache()}
              sx={{
                color: "text.secondary",
                display: "block",
                fontSize: "0.75rem",
                minWidth: 0,
                mx: "auto",
                mt: 0.5,
                opacity: 0.75,
                px: 0.5,
                textTransform: "none",
              }}
            >
              Clear cache
            </Button>
          </Stack>
        </Stack>
      </Box>
    </div>
  );
}
