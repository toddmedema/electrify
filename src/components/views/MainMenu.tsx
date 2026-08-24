import * as React from "react";
import { Button, IconButton } from "@mui/material";
import EmailIcon from "@mui/icons-material/Email";
import InfoIcon from "@mui/icons-material/Info";
import { login } from "../../Globals";

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
  return (
    <div id="menuCard">
      <div id="logo">
        <img src="images/logo.svg" alt="Logo"></img>
      </div>
      <div id="centeredMenu">
        {props.hasSavedGame && (
          <Button
            size="large"
            variant="contained"
            color="primary"
            onClick={props.onContinue}
            autoFocus={true}
          >
            Continue
          </Button>
        )}
        <Button
          size="large"
          variant={props.hasSavedGame ? "outlined" : "contained"}
          color="primary"
          onClick={props.onStart}
          autoFocus={!props.hasSavedGame}
        >
          Play
        </Button>
        <Button variant="outlined" color="primary" onClick={props.onManual}>
          Manual
        </Button>
        <Button variant="outlined" color="primary" onClick={props.onSettings}>
          Options
        </Button>
        {!props.uid && (
          <Button variant="outlined" color="primary" onClick={login}>
            Log in
          </Button>
        )}
        {props.audioEnabled === undefined && (
          <Button
            variant="outlined"
            color="primary"
            onClick={() => props.onAudioChange(true)}
            style={{ display: "inline", marginRight: "12px", marginTop: "4px" }}
          >
            Enable music
          </Button>
        )}
      </div>
      <div
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
      </div>
    </div>
  );
};

export default MainMenu;
