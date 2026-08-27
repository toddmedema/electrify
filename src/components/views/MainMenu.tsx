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
  const startLabel = props.hasSavedGame
    ? "Choose a mission"
    : "Start guided missions";
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
        <Typography className="gamePromise" variant="h5" component="p">
          Build power plants. Keep the lights on. Make your grid cleaner.
        </Typography>
        <Typography className="gameReassurance" variant="body1" component="p">
          Learn as you play — no energy or gaming experience needed.
        </Typography>
        <Stack className="mainActions" spacing={1.25}>
          {props.hasSavedGame && (
            <Button
              size="large"
              variant="contained"
              color="primary"
              onClick={props.onContinue}
              autoFocus={true}
            >
              Continue your game
            </Button>
          )}
          <Button
            size="large"
            variant={props.hasSavedGame ? "outlined" : "contained"}
            color="primary"
            onClick={props.onStart}
            autoFocus={!props.hasSavedGame}
          >
            {startLabel}
          </Button>
          {!props.hasSavedGame && (
            <Typography variant="caption">Free · no account needed</Typography>
          )}
        </Stack>
        <Stack
          component="nav"
          aria-label="Game resources"
          direction="row"
          useFlexGap
          sx={{
            mx: "auto",
            maxWidth: 440,
            flexWrap: "wrap",
            justifyContent: "center",
            "& > button": { m: "0 4px 8px !important" },
          }}
        >
          <Button variant="text" color="primary" onClick={props.onManual}>
            Manual
          </Button>
          <Button variant="text" color="primary" onClick={props.onSettings}>
            Options
          </Button>
          {!props.uid && (
            <Button variant="text" color="primary" onClick={login}>
              Sign in with Google
            </Button>
          )}
        </Stack>
        <Stack
          className="discoveryActions"
          direction="row"
          useFlexGap
          sx={{ flexWrap: "wrap", justifyContent: "center" }}
        >
          <InstallAppButton />
          {canShare() && (
            <Button color="primary" startIcon={<ShareIcon />} onClick={onShare}>
              Share game
            </Button>
          )}
          {props.audioEnabled === undefined && (
            <Button
              color="primary"
              startIcon={<VolumeUpIcon />}
              onClick={() => props.onAudioChange(true)}
            >
              Play with sound
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
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          opacity: 0.7,
        }}
      >
        <IconButton
          color="primary"
          href="mailto:todd@fabricate.io"
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
