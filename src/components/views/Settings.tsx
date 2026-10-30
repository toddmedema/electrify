import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  Paper,
  Slider,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { ChevronDownGlyph } from "../base/Glyphs";
import {
  SettingsType,
  TextSizeType,
  ThemeChoiceType,
  UnitSystemType,
} from "../../Types";
import { TEXT_SIZES, TEXT_SIZE_LABELS } from "../../TextSize";
import { useControllerInput } from "../../desktop/InputPresentation";
import { UNIT_SYSTEMS, UNIT_SYSTEM_LABELS } from "../../helpers/Units";
import { THEME_CHOICES, THEME_LABELS } from "../../Theme";
import KeyboardShortcuts, { SHORTCUTS } from "../base/KeyboardShortcuts";
import ScreenPage from "../base/ScreenPage";
import InstallAppButton, { useCanInstallApp } from "../base/InstallAppButton";
import { APP_VERSION } from "../../AppVersion";
import { clearAppCache } from "../../helpers/Cache";
import { getDesktop, isDesktopApp } from "../../Desktop";
import { useDesktopState } from "../../DesktopState";
import { restoreMenuFocus, useMenuKeys } from "../base/useMenuKeys";
import type { SignInOptions } from "../../Globals";
import MailingListCheckbox from "../base/MailingListCheckbox";
const CreditsDialog = React.lazy(() => import("../base/CreditsDialog"));
const DesktopDisplaySettings =
  process.env.REACT_APP_DESKTOP === "true"
    ? React.lazy(() => import("../base/DesktopDisplaySettings"))
    : () => null;
const DesktopFeedbackSettings =
  process.env.REACT_APP_DESKTOP === "true"
    ? React.lazy(() => import("../base/DesktopFeedbackSettings"))
    : () => null;

export interface StateProps {
  settings: SettingsType;
  loggedIn: boolean;
  // The leaderboard name, when one has been claimed
  displayName?: string;
}

export interface DispatchProps {
  onLogin: (options?: SignInOptions) => void;
  onLogout: () => void;
  onChangeName: () => void;
  onAudioChange: (change: boolean) => void;
  onMusicVolumeChange: (change: number) => void;
  onSoundEffectsVolumeChange: (change: number) => void;
  onUnitsChange: (change: UnitSystemType) => void;
  onThemeChange: (change: ThemeChoiceType) => void;
  onTextSizeChange: (change: TextSizeType) => void;
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
        className="sectionLabel"
      >
        {title}
      </Typography>
      <Paper variant="outlined" className="groupedList">
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
          sm: "minmax(180px, 1fr) auto",
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
          // Controls hug their content at the row's right edge; stacked phone rows stretch instead
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
      className="settingsKeyboardRow"
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
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {props.label}
      </Typography>
      <Slider
        aria-label={`${props.label} volume`}
        getAriaValueText={(sliderValue: number) => `${sliderValue} percent`}
        value={value}
        onChange={(_e: Event, sliderValue: number | number[]) =>
          props.onChange((sliderValue as number) / 100)
        }
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
  const [creditsOpen, setCreditsOpen] = React.useState(false);
  const [mailingList, setMailingList] = React.useState(false);
  const canInstallApp = useCanInstallApp();
  const desktopApp = process.env.REACT_APP_DESKTOP === "true" && isDesktopApp();
  const desktop = useDesktopState();
  const controllerInput = useControllerInput();
  const onBack = () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    props.onBack();
    // Card transitions replace the button that opened Settings. Once the previous card is back,
    // return keyboard users to its stable replacement instead of leaving focus on <body>.
    restoreMenuFocus("[data-settings-trigger]");
  };
  const menuKeys = useMenuKeys(true, onBack);

  return (
    <ScreenPage
      className="keyboardMenu"
      id="gameCard"
      {...menuKeys}
      title="Settings"
      onBack={onBack}
    >
      <Box
        className="scrollable"
        sx={{
          width: "100%",
          boxSizing: "border-box",
          overflowY: "auto",
        }}
      >
        <Stack
          spacing={2.5}
          sx={{
            width: "100%",
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

              <SettingRow
                label="Text size"
                description="Enlarge text, chart labels and controls on this device."
                stackOnMobile
              >
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={props.settings.textSize ?? "standard"}
                  aria-label="Text size"
                  onChange={(
                    _e: React.MouseEvent<HTMLElement>,
                    value: TextSizeType | null,
                  ) => value && props.onTextSizeChange(value)}
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
                  {TEXT_SIZES.map((size) => (
                    <ToggleButton value={size} key={size}>
                      {TEXT_SIZE_LABELS[size]}
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
              {desktopApp && (
                <React.Suspense fallback={null}>
                  <DesktopFeedbackSettings kind="vibration" />
                </React.Suspense>
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

          {desktopApp && (
            <SettingsGroup id="display-settings" title="Display">
              <React.Suspense
                fallback={
                  <Typography sx={{ p: 2 }}>
                    Loading display settings…
                  </Typography>
                }
              >
                <DesktopDisplaySettings />
              </React.Suspense>
            </SettingsGroup>
          )}
          <SettingsGroup
            id="leaderboard-settings"
            title={desktopApp ? "Steam" : "Leaderboard"}
          >
            {desktopApp ? (
              <Stack divider={<Divider flexItem />}>
                <SettingRow
                  label={desktop?.steam.displayName || "Steam player"}
                  description={
                    desktop?.steam.available
                      ? desktop.steam.online
                        ? "Steam is connected. Scores use your Steam profile name."
                        : "Steam is offline. Play and save on this device."
                      : "Steam is unavailable. Play and save on this device. Launch through Steam to connect."
                  }
                  stackOnMobile
                >
                  <Button
                    variant="outlined"
                    disabled={!desktop?.steam.online}
                    onClick={() =>
                      void getDesktop()
                        ?.openFriends()
                        .catch(() => undefined)
                    }
                  >
                    Steam friends
                  </Button>
                </SettingRow>
                <React.Suspense fallback={null}>
                  <DesktopFeedbackSettings
                    kind="timeline"
                    timelineSupported={desktop?.steam.timelineSupported}
                  />
                </React.Suspense>
              </Stack>
            ) : (
              <>
                <SettingRow
                  label={props.loggedIn ? "Leaderboard name" : "Public profile"}
                  description={
                    props.loggedIn
                      ? props.displayName
                        ? props.displayName
                        : "Choose a public name for your scores."
                      : "Sign in to post scores under a public name."
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
                        flex: props.loggedIn
                          ? { xs: "1 1 140px", sm: "0 0 auto" }
                          : "0 0 auto",
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
                      <Stack spacing={1} sx={{ maxWidth: "100%" }}>
                        <MailingListCheckbox
                          checked={mailingList}
                          onChange={setMailingList}
                        />
                        <Button
                          variant="outlined"
                          onClick={() => props.onLogin({ mailingList })}
                        >
                          Sign in with Google
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                </SettingRow>
              </>
            )}
          </SettingsGroup>

          {!desktopApp && canInstallApp && (
            <SettingsGroup id="app-settings" title="Install Electrify">
              <SettingRow
                label="Install app"
                description="Play full screen and offline."
              >
                <InstallAppButton label="Install" />
              </SettingRow>
            </SettingsGroup>
          )}

          {!controllerInput && (
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
                  expandIcon={<ChevronDownGlyph className="rowChevron" />}
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
          )}

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
              "& .MuiButton-root": {
                color: "text.secondary",
                fontSize: "0.8125rem",
              },
            }}
          >
            <Typography
              variant="caption"
              sx={{
                px: 1,
                width: { xs: "100%", sm: "auto" },
                textAlign: "center",
              }}
            >
              {APP_VERSION}
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={() => setCreditsOpen(true)}
            >
              Credits and licenses
            </Button>
            <Button
              component="a"
              href="https://github.com/toddmedema/electrify"
              target="_blank"
              rel="noreferrer"
              variant="text"
              size="small"
            >
              GitHub
            </Button>
            {!desktopApp && (
              <Button
                variant="text"
                size="small"
                onClick={() => void clearAppCache()}
              >
                Clear cache
              </Button>
            )}
          </Stack>
          {creditsOpen && (
            <React.Suspense fallback={null}>
              <CreditsDialog onClose={() => setCreditsOpen(false)} />
            </React.Suspense>
          )}
        </Stack>
      </Box>
    </ScreenPage>
  );
}
