import { DISCORD_URL, FEEDBACK_URL } from "../../CommunityLinks";
import * as React from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  SvgIcon,
  Typography,
  useTheme,
} from "@mui/material";
import EmailIcon from "@mui/icons-material/Email";
import InfoIcon from "@mui/icons-material/Info";
import ShareIcon from "@mui/icons-material/Share";
import {
  buildGameShareContent,
  canShare,
  shareText,
} from "../../helpers/Share";
import InstallAppButton from "../base/InstallAppButton";
import { getDesktop, isDesktopApp } from "../../Desktop";
import { useMenuKeys } from "../base/useMenuKeys";
// Keep Steam's co-op UI and authoritative worker out of the browser edition entirely.
const MultiplayerButton =
  process.env.REACT_APP_DESKTOP === "true"
    ? React.lazy(() => import("../../multiplayer/Button"))
    : () => null;

export interface StateProps {
  audioEnabled?: boolean;
  hasSavedGame: boolean;
  hasSavedGames: boolean;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onContinue: () => void;
  onSavedGames: () => void;
  onSettings: () => void;
  onMods: () => void;
  onAchievements?: () => void;
  onManual: () => void;
  onStart: () => void;
}

export interface Props extends StateProps, DispatchProps {}

// MUI ships no Discord glyph, so wrap the Simple Icons path in SvgIcon to inherit MUI sizing/color.
const DiscordIcon = () => (
  <SvgIcon>
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </SvgIcon>
);

// Mouse movement shares selection with keyboard/controller focus. A touch drag is scrolling,
// not hover selection. Boundary events alone can also come from the entrance moving beneath
// a stationary pointer.
const HOME_MENU_BUTTONS =
  ".mainActions button, .resourceActions button, .discoveryActions button";
function focusHomeButton(event: React.PointerEvent) {
  if (event.pointerType !== "mouse") return;
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>(HOME_MENU_BUTTONS);
  if (button) {
    delete document.documentElement.dataset.touchInput;
    if (button !== document.activeElement)
      button.focus({ preventScroll: true });
  }
}

const MainMenu = (props: Props): React.JSX.Element => {
  const menuKeys = useMenuKeys();
  // Native :active can wait until touch release. Track contact without delaying the click
  // or taking over the browser's scrolling and pointer-cancellation behavior.
  const pressedButton = React.useRef<HTMLElement | null>(null);
  const clearTouchPress = () => {
    pressedButton.current?.removeAttribute("data-touch-pressed");
    pressedButton.current = null;
  };
  const onTouchPress = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    clearTouchPress();
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "button,a[href]",
    );
    if (button && !button.matches(":disabled,[aria-disabled=true]")) {
      pressedButton.current = button;
      button.setAttribute("data-touch-pressed", "");
    }
  };
  const onTouchMove = (event: React.PointerEvent) => {
    if (!pressedButton.current) return;
    const { left, right, top, bottom } =
      pressedButton.current.getBoundingClientRect();
    if (
      event.clientX < left ||
      event.clientX > right ||
      event.clientY < top ||
      event.clientY > bottom
    )
      clearTouchPress();
  };
  const desktopApp = process.env.REACT_APP_DESKTOP === "true" && isDesktopApp();
  // The desktop game bundles no website pages, so those open in the player's browser.
  const sitePage = (path: string) =>
    desktopApp
      ? {
          href: `https://electrifygame.com${path}`,
          target: "_blank",
          rel: "noopener noreferrer",
        }
      : { href: path };
  const startLabel = props.hasSavedGame ? "New game" : "Play";
  const [shareStatus, setShareStatus] = React.useState("");
  // An <img> can't read the page's custom properties, so dark swaps in a copy of the logo painted
  // in dark's desaturated blue; the overlaid pulse and smoke follow --interactive-blue on their own
  const dark = useTheme().palette.mode === "dark";

  const onShare = async () => {
    const result = await shareText(buildGameShareContent());
    if (result === "clipboard") {
      setShareStatus("Game link copied.");
    } else if (result === "unavailable") {
      setShareStatus("Sharing isn't available in this browser.");
    }
  };

  return (
    <div
      id="menuCard"
      onPointerDown={onTouchPress}
      onPointerMove={onTouchMove}
      onPointerUp={clearTouchPress}
      onPointerCancel={clearTouchPress}
      onPointerLeave={clearTouchPress}
    >
      <div id="logo">
        <div className="homeLogo">
          <img
            src={dark ? "images/logo-home-dark.svg" : "images/logo-home.svg"}
            alt="Electrify"
            width="300"
            height="70"
          />
          <svg
            className="homeEnergyTrace"
            viewBox="0 0 300 70"
            aria-hidden="true"
            focusable="false"
          >
            <path
              className="homeEnergyPulse"
              d="M57.7873 5.39465C57.7873 5.39465 85.2179 11.978 107.162 11.978C129.107 11.978 150.32 8.22915 150.32 8.22915"
              pathLength="100"
            />
            <g className="homeSmoke">
              <g className="homeSmokePuff">
                <g className="homeSmokeLift">
                  <circle cx="222" cy="8.1" r="4.4" />
                </g>
              </g>
              <g className="homeSmokePuff">
                <g className="homeSmokeLift">
                  <circle cx="222" cy="8.1" r="4.4" />
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
      <Typography component="h1" className="srOnly">
        Electrify
      </Typography>
      <Box
        id="centeredMenu"
        className="keyboardMenu"
        {...menuKeys}
        onPointerMove={focusHomeButton}
        sx={{ px: 3 }}
      >
        <Stack
          component="section"
          aria-label="Primary actions"
          className="mainActions"
          spacing={1}
          useFlexGap
        >
          {props.hasSavedGame && (
            <Button
              data-main-action
              size="large"
              color="primary"
              onClick={props.onContinue}
            >
              Continue
            </Button>
          )}
          <Button
            data-main-action
            size="large"
            color="primary"
            onClick={props.onStart}
          >
            {startLabel}
          </Button>
          {props.hasSavedGames && (
            <Button
              data-saves-trigger
              size="large"
              color="primary"
              onClick={props.onSavedGames}
            >
              Saved games
            </Button>
          )}
          {desktopApp && (
            <React.Suspense fallback={null}>
              <MultiplayerButton />
            </React.Suspense>
          )}
        </Stack>
        <Stack
          component="nav"
          aria-label="Game resources"
          className="resourceActions"
          direction="column"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!desktopApp && (
            <Button
              data-achievements-trigger
              variant="text"
              color="primary"
              onClick={props.onAchievements}
            >
              Achievements
            </Button>
          )}
          <Button
            data-manual-trigger
            variant="text"
            color="primary"
            onClick={props.onManual}
          >
            Manual
          </Button>
          {desktopApp && getDesktop()?.mods && (
            <Button
              data-mods-trigger
              variant="text"
              color="primary"
              onClick={props.onMods}
            >
              Mods
            </Button>
          )}
          <Button
            data-settings-trigger
            variant="text"
            color="primary"
            onClick={props.onSettings}
          >
            Settings
          </Button>
          {desktopApp && (
            <Button
              variant="text"
              color="primary"
              onClick={() => void getDesktop()?.quit()}
            >
              Quit
            </Button>
          )}
        </Stack>
        <Box className="utilityActions">
          <Stack
            component="section"
            aria-label="Discovery actions"
            className="discoveryActions"
            direction="column"
            spacing={1}
            useFlexGap
            sx={{
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {!desktopApp && <InstallAppButton showIcon={false} />}
            {props.audioEnabled === undefined && !desktopApp && (
              <Button color="primary" onClick={() => props.onAudioChange(true)}>
                Turn on sound
              </Button>
            )}
          </Stack>
        </Box>
        <Typography className="srOnly" role="status" aria-live="polite">
          {shareStatus}
        </Typography>
      </Box>
      <footer className="mainMenuFooter">
        <IconButton
          color="primary"
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Join the Electrify Discord"
          size="large"
        >
          <DiscordIcon />
        </IconButton>
        <IconButton
          color="primary"
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Send feedback"
          size="large"
        >
          <EmailIcon />
        </IconButton>
        <IconButton
          color="primary"
          {...sitePage("/about.html")}
          aria-label="About Electrify"
          size="large"
        >
          <InfoIcon />
        </IconButton>
        {canShare() && (
          <IconButton
            color="primary"
            onClick={onShare}
            aria-label="Share Electrify"
            size="large"
          >
            {/* Share has one extra pixel of leading whitespace beside the other footer glyphs. */}
            <ShareIcon sx={{ transform: "translateX(-1px)" }} />
          </IconButton>
        )}
      </footer>
    </div>
  );
};

export default MainMenu;
