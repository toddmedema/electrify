import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  IconButton,
  Paper,
  Slider,
  Stack,
  Switch,
  Toolbar,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { SettingsType, ThemeChoiceType, UnitSystemType } from "../../Types";
import { UNIT_SYSTEMS, UNIT_SYSTEM_LABELS } from "../../helpers/Units";
import { THEME_CHOICES, THEME_LABELS } from "../../Theme";
import KeyboardShortcuts, { SHORTCUTS } from "../base/KeyboardShortcuts";
import InstallAppButton, { useCanInstallApp } from "../base/InstallAppButton";
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

interface SettingsGroupProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

function SettingsGroup({
  id,
  title,
  children,
}: SettingsGroupProps): React.JSX.Element {
  return (
    <Box component="section" className="settingsGroup" aria-labelledby={id}>
      <Typography
        id={id}
        component="h2"
        variant="overline"
        color="text.secondary"
        sx={{ display: "block", mb: 0.75, px: 0.5, fontWeight: 700 }}
      >
        {title}
      </Typography>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: "hidden" }}>
        {children}
      </Paper>
    </Box>
  );
}

interface SettingRowProps {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  stackOnMobile?: boolean;
}

function SettingRow({
  label,
  description,
  children,
  stackOnMobile = false,
}: SettingRowProps): React.JSX.Element {
  return (
    <Box
      className="settingsRow"
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: stackOnMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
          sm: "minmax(180px, 1fr) minmax(260px, auto)",
        },
        alignItems: "center",
        gap: { xs: stackOnMobile ? 1.5 : 1, sm: 3 },
        minHeight: 56,
        px: 2,
        py: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
        {description && (
          <Typography
            component="div"
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.25, lineHeight: 1.45 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          minWidth: 0,
          width: stackOnMobile ? "100%" : "auto",
          justifySelf: { xs: stackOnMobile ? "stretch" : "end", sm: "end" },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function VolumeSlider(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const value = Math.round(props.value * 100);
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "64px minmax(0, 1fr) 42px",
          sm: "140px minmax(0, 1fr) 46px",
        },
        alignItems: "center",
        gap: 1.5,
        minHeight: 48,
        px: 2,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {props.label}
      </Typography>
      <Slider
        aria-label={`${props.label} volume`}
        getAriaValueText={(sliderValue: number) => `${sliderValue} percent`}
        value={value}
        onChange={(_e: Event, sliderValue: number | number[]) =>
          props.onChange((sliderValue as number) / 100)
        }
        sx={{ width: "100% !important" }}
      />
      <Typography
        variant="body2"
        color="text.secondary"
        aria-hidden="true"
        sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
      >
        {value}%
      </Typography>
    </Box>
  );
}

export default function Settings(props: Props): React.JSX.Element {
  const canInstallApp = useCanInstallApp();
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
  const onBack = () => {
    props.onBack();
    // Card transitions replace the button that opened Settings. Once the previous card is back,
    // return keyboard users to its stable replacement instead of leaving focus on <body>.
    window.setTimeout(() => {
      document.querySelector<HTMLElement>("[data-settings-trigger]")?.focus();
    }, 350);
  };

  return (
    <div className="flexContainer" id="gameCard">
      <div id="topbar">
        <Toolbar
          sx={{ position: "relative", borderBottom: 1, borderColor: "divider" }}
        >
          <IconButton
            onClick={onBack}
            aria-label="Back"
            edge="start"
            color="primary"
            size="large"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography
            component="h1"
            variant="h6"
            sx={{
              position: { xs: "absolute", sm: "static" },
              left: { xs: "50%", sm: "auto" },
              transform: { xs: "translateX(-50%)", sm: "none" },
            }}
          >
            Settings
          </Typography>
        </Toolbar>
      </div>
      <Box
        className="scrollable"
        sx={{
          width: "100%",
          boxSizing: "border-box",
          overflowY: "auto",
          backgroundColor: "var(--bg-sunken)",
        }}
      >
        <Stack
          spacing={2.5}
          sx={{
            width: "100%",
            maxWidth: 760,
            mx: "auto",
            px: { xs: 2, sm: 3 },
            pt: { xs: 2, sm: 3 },
            pb: "max(24px, env(safe-area-inset-bottom))",
            boxSizing: "border-box",
          }}
        >
          <SettingsGroup id="preferences-settings" title="Preferences">
            <Stack divider={<Divider flexItem />}>
              <SettingRow
                label="Appearance"
                description={
                  props.settings.theme === "system"
                    ? "Uses your device setting."
                    : undefined
                }
                stackOnMobile
              >
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={props.settings.theme}
                  aria-label="Appearance"
                  onChange={(
                    _e: React.MouseEvent<HTMLElement>,
                    value: ThemeChoiceType | null,
                  ) => value && props.onThemeChange(value)}
                  sx={{
                    width: { xs: "100%", sm: "auto" },
                    "& .MuiToggleButton-root": {
                      flex: { xs: 1, sm: "0 0 auto" },
                      minWidth: { sm: 76 },
                      px: { xs: 1, sm: 1.5 },
                      textTransform: "none",
                    },
                  }}
                >
                  {THEME_CHOICES.map((choice: ThemeChoiceType) => (
                    <ToggleButton value={choice} key={choice}>
                      {choice === "system" ? "System" : THEME_LABELS[choice]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </SettingRow>

              <SettingRow label="Sound" description="Music and effects">
                <Switch
                  color="primary"
                  id="sound"
                  slotProps={{ input: { "aria-label": "Sound" } }}
                  checked={!!props.settings.audioEnabled}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    props.onAudioChange(e.target.checked)
                  }
                />
              </SettingRow>

              {!!props.settings.audioEnabled && (
                <Box>
                  <VolumeSlider
                    label="Music"
                    value={props.settings.musicVolume}
                    onChange={props.onMusicVolumeChange}
                  />
                  <VolumeSlider
                    label="Effects"
                    value={props.settings.soundEffectsVolume}
                    onChange={props.onSoundEffectsVolumeChange}
                  />
                </Box>
              )}

              <SettingRow
                label="Units"
                description={
                  props.settings.units === "imperial"
                    ? "°F · mph · lb · tons"
                    : "°C · km/h · kg · tonnes"
                }
                stackOnMobile
              >
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={props.settings.units}
                  aria-label="Units"
                  onChange={(
                    _e: React.MouseEvent<HTMLElement>,
                    value: UnitSystemType | null,
                  ) => value && props.onUnitsChange(value)}
                  sx={{
                    width: { xs: "100%", sm: "auto" },
                    "& .MuiToggleButton-root": {
                      flex: { xs: 1, sm: "0 0 auto" },
                      minWidth: { sm: 112 },
                      textTransform: "none",
                    },
                  }}
                >
                  {UNIT_SYSTEMS.map((system: UnitSystemType) => (
                    <ToggleButton value={system} key={system}>
                      {UNIT_SYSTEM_LABELS[system]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </SettingRow>
            </Stack>
          </SettingsGroup>

          <SettingsGroup id="leaderboard-settings" title="Leaderboard">
            <SettingRow
              label={props.loggedIn ? "Leaderboard name" : "Public profile"}
              description={
                props.loggedIn
                  ? props.displayName
                    ? props.displayName
                    : "Choose a name to appear with your scores."
                  : "Sign in to add a public name and score to the leaderboard."
              }
              stackOnMobile
            >
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  width: { xs: "100%", sm: "auto" },
                  flexWrap: "wrap",
                  "& .MuiButton-root": {
                    flex: { xs: "1 1 140px", sm: "0 0 auto" },
                  },
                }}
              >
                {props.loggedIn ? (
                  <>
                    <Button variant="outlined" onClick={props.onChangeName}>
                      {props.displayName ? "Edit name" : "Choose a name"}
                    </Button>
                    <Button variant="text" onClick={props.onLogout}>
                      Sign out
                    </Button>
                  </>
                ) : (
                  <Button variant="outlined" onClick={props.onLogin}>
                    Sign in with Google
                  </Button>
                )}
              </Stack>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup id="saved-game-settings" title="Game data">
            <SettingRow
              label="Saved game"
              description={
                props.savedGame
                  ? `Export “${props.savedGame}” to keep or share. Importing replaces your current save.`
                  : "Start a game to enable export. You can still import a shared save."
              }
              stackOnMobile
            >
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  width: { xs: "100%", sm: "auto" },
                  flexWrap: "wrap",
                  "& .MuiButton-root": {
                    flex: { xs: "1 1 120px", sm: "0 0 auto" },
                  },
                }}
              >
                <Button
                  variant="outlined"
                  disabled={!props.savedGame}
                  onClick={props.onExportSave}
                >
                  Export save
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => fileInput.current?.click()}
                >
                  Import save
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
            </SettingRow>
          </SettingsGroup>

          {canInstallApp && (
            <SettingsGroup id="app-settings" title="Install Electrify">
              <SettingRow
                label="Install app"
                description="Play full screen and offline."
              >
                <InstallAppButton label="Install" />
              </SettingRow>
            </SettingsGroup>
          )}

          <SettingsGroup id="keyboard-settings" title="Keyboard shortcuts">
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                "&::before": { display: "none" },
                backgroundColor: "transparent",
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="keyboard-shortcuts-content"
                id="keyboard-shortcuts-summary"
                sx={{ minHeight: 56, px: 2 }}
              >
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>
                    Keys for faster play
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    View {SHORTCUTS.length} shortcuts
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails
                id="keyboard-shortcuts-content"
                sx={{ px: 2, pt: 0 }}
              >
                <KeyboardShortcuts />
              </AccordionDetails>
            </Accordion>
          </SettingsGroup>

          <Stack
            component="footer"
            direction="row"
            spacing={0.5}
            useFlexGap
            sx={{
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              color: "text.secondary",
            }}
          >
            <Typography variant="caption" sx={{ px: 1 }}>
              Electrify v{packageJson.version}
            </Typography>
            <Button
              component="a"
              href="https://github.com/toddmedema/electrify"
              target="_blank"
              rel="noreferrer"
              variant="text"
              size="small"
              sx={{ color: "text.secondary", fontSize: "0.75rem" }}
            >
              GitHub
            </Button>
            <Button
              component="a"
              href="/privacy.html"
              variant="text"
              size="small"
              sx={{ color: "text.secondary", fontSize: "0.75rem" }}
            >
              Privacy
            </Button>
            <Button
              variant="text"
              size="small"
              onClick={() => void clearAppCache()}
              sx={{ color: "text.secondary", fontSize: "0.75rem" }}
            >
              Clear cached data
            </Button>
          </Stack>
        </Stack>
      </Box>
    </div>
  );
}
