import * as React from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  SvgIcon,
  Typography,
} from "@mui/material";
import EmailIcon from "@mui/icons-material/Email";
import InfoIcon from "@mui/icons-material/Info";
import ShareIcon from "@mui/icons-material/Share";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import {
  buildGameShareContent,
  canShare,
  shareText,
} from "../../helpers/Share";
import InstallAppButton from "../base/InstallAppButton";

export interface StateProps {
  audioEnabled?: boolean;
  hasSavedGame: boolean;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onContinue: () => void;
  onSettings: () => void;
  onManual: () => void;
  onStart: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const DISCORD_URL = "https://discord.gg/Chrjk36DC";

// MUI ships no Discord glyph, so wrap the Simple Icons path in SvgIcon to inherit MUI sizing/color.
const DiscordIcon = () => (
  <SvgIcon>
    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
  </SvgIcon>
);

const MainMenu = (props: Props): React.JSX.Element => {
  const startLabel = props.hasSavedGame ? "Start a new game" : "Start playing";
  const [shareStatus, setShareStatus] = React.useState("");

  const onShare = async () => {
    const result = await shareText(buildGameShareContent());
    if (result === "clipboard") {
      setShareStatus("Game link copied.");
    } else if (result === "unavailable") {
      setShareStatus("Sharing isn't available in this browser.");
    }
  };

  return (
    <div id="menuCard">
      <div id="logo">
        <div className="homeLogo">
          <img src="images/logo-home.svg" alt="Electrify" />
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
              <circle className="homeSmokePuff" cx="222" cy="8.1" r="4.4" />
              <circle className="homeSmokePuff" cx="222" cy="8.1" r="4.4" />
            </g>
          </svg>
        </div>
      </div>
      <Typography component="h1" className="srOnly">
        Electrify
      </Typography>
      <Box id="centeredMenu" sx={{ px: 3 }}>
        <Typography className="gameSubtitle" variant="body1" component="p">
          Keep the lights on. Build a cleaner grid.
        </Typography>
        <Stack
          component="section"
          aria-label="Primary actions"
          className="mainActions"
          spacing={1.5}
          useFlexGap
        >
          {props.hasSavedGame && (
            <Button
              data-main-action
              size="large"
              variant="contained"
              color="primary"
              onClick={props.onContinue}
            >
              Continue
            </Button>
          )}
          <Button
            data-main-action
            size="large"
            variant={props.hasSavedGame ? "outlined" : "contained"}
            color="primary"
            onClick={props.onStart}
          >
            {startLabel}
          </Button>
        </Stack>
        <Stack
          component="nav"
          aria-label="Game resources"
          className="resourceActions"
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Button variant="text" color="primary" onClick={props.onManual}>
            Manual
          </Button>
          <Button
            data-settings-trigger
            variant="text"
            color="primary"
            onClick={props.onSettings}
          >
            Settings
          </Button>
        </Stack>
        <Box className="utilityActions">
          <Stack
            component="section"
            aria-label="Discovery actions"
            className="discoveryActions"
            direction="row"
            spacing={1}
            useFlexGap
            sx={{
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <InstallAppButton />
            {props.audioEnabled === undefined && (
              <Button
                color="primary"
                endIcon={<VolumeUpIcon />}
                onClick={() => props.onAudioChange(true)}
              >
                Turn on sound
              </Button>
            )}
          </Stack>
        </Box>
        <Typography className="srOnly" role="status" aria-live="polite">
          {shareStatus}
        </Typography>
      </Box>
      <footer
        className="mainMenuFooter"
        style={{
          opacity: 0.7,
        }}
      >
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
          href="/about.html#feedback"
          aria-label="Send feedback"
          size="large"
        >
          <EmailIcon />
        </IconButton>
        <IconButton
          color="primary"
          href="/about.html"
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
            <ShareIcon />
          </IconButton>
        )}
        <Button color="primary" href="/privacy.html" size="small">
          Privacy
        </Button>
      </footer>
    </div>
  );
};

export default MainMenu;
