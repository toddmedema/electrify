import * as React from "react";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import EmailIcon from "@mui/icons-material/Email";
import InfoIcon from "@mui/icons-material/Info";
import ShareIcon from "@mui/icons-material/Share";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import { login } from "../../Globals";
import {
  buildGameShareContent,
  canShare,
  shareText,
} from "../../helpers/Share";
import InstallAppButton from "../base/InstallAppButton";

export interface StateProps {
  audioEnabled?: boolean;
  hasSavedGame: boolean;
  uid?: string;
}

export interface DispatchProps {
  onAudioChange: (change: boolean) => void;
  onContinue: () => void;
  onSettings: () => void;
  onManual: () => void;
  onStart: () => void;
}

export interface Props extends StateProps, DispatchProps {}

const MainMenu = (props: Props): React.JSX.Element => {
  const startLabel = props.hasSavedGame ? "Start a new game" : "Start playing";
  const [shareStatus, setShareStatus] = React.useState("");

  const onShare = async () => {
    const result = await shareText(buildGameShareContent());
    if (result === "clipboard") {
      setShareStatus("Game link copied. Paste it wherever you like.");
    } else if (result === "unavailable") {
      setShareStatus("Sharing isn't available in this browser.");
    }
  };

  return (
    <div id="menuCard">
      <div id="logo">
        <img
          src="images/logo.svg"
          alt="Electrify"
          style={{ maxWidth: 680 }}
        ></img>
      </div>
      <Typography component="h1" className="srOnly">
        Electrify
      </Typography>
      <Box id="centeredMenu" sx={{ px: 3 }}>
        <Typography className="gameSubtitle" variant="body1" component="p">
          Keep the lights on. Build a cleaner energy future.
        </Typography>
        <Stack
          component="section"
          aria-label="Primary actions"
          className="mainActions"
          spacing={1.25}
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
          {!props.hasSavedGame && !props.uid && (
            <Typography variant="caption">Free · no sign-up needed</Typography>
          )}
        </Stack>
        <Stack
          component="nav"
          aria-label="Game resources"
          className="resourceActions"
          direction="row"
          spacing={0.75}
          useFlexGap
          sx={{
            alignItems: "center",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Button variant="text" color="primary" onClick={props.onManual}>
            How to play
          </Button>
          <Button
            data-settings-trigger
            variant="text"
            color="primary"
            onClick={props.onSettings}
          >
            Settings
          </Button>
          {!props.uid && (
            <Button variant="text" color="primary" onClick={login}>
              Sign in
            </Button>
          )}
        </Stack>
        <Stack
          component="section"
          aria-label="Discovery actions"
          className="discoveryActions"
          direction="row"
          spacing={0.75}
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
              startIcon={<VolumeUpIcon />}
              onClick={() => props.onAudioChange(true)}
            >
              Turn on sound
            </Button>
          )}
        </Stack>
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
        <Button color="primary" href="/privacy.html" size="small">
          Privacy
        </Button>
      </footer>
    </div>
  );
};

export default MainMenu;
