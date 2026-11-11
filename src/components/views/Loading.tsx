import * as React from "react";
import {
  Button,
  CircularProgress,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { GameType } from "../../Types";

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  load: (game: GameType, onError: (message: string) => void) => void;
  onExit: () => void;
}

export interface Props extends StateProps, DispatchProps {}

interface LoadingState {
  error?: string;
}

// An <img> can't read the page's custom properties, so dark mode swaps in a copy of the logo
// painted in dark's desaturated blue rather than recolouring this one
function LoadingLogo(): React.JSX.Element {
  const dark = useTheme().palette.mode === "dark";
  return (
    <img
      src={dark ? "images/logo-dark.svg" : "images/logo.svg"}
      alt="Electrify"
    />
  );
}

export default class Loading extends React.PureComponent<Props, LoadingState> {
  public state: LoadingState = {};
  private mounted = false;

  public componentDidMount() {
    this.mounted = true;
    this.beginLoad();
  }

  public componentWillUnmount() {
    this.mounted = false;
  }

  private beginLoad = () => {
    this.setState({ error: undefined });
    this.props.load(
      this.props.game,
      (error) => this.mounted && this.setState({ error }),
    );
  };

  public render() {
    return (
      <div className="flex-fully-centered">
        <div id="logo" className="fadein-slow">
          <LoadingLogo />
        </div>
        {this.state.error ? (
          <Stack
            spacing={2}
            role="alert"
            sx={{ px: 3, textAlign: "center", maxWidth: 420 }}
          >
            <Typography component="h1" variant="h6">
              We couldn't prepare this grid
            </Typography>
            <Typography>{this.state.error}</Typography>
            {!navigator.onLine && (
              <Typography variant="body2">
                You're offline. Reconnect, then retry. Games already cached on
                this device remain available.
              </Typography>
            )}
            <Button variant="contained" onClick={this.beginLoad}>
              Retry
            </Button>
            <Button onClick={this.props.onExit}>Back to missions</Button>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ alignItems: "center" }}>
            <CircularProgress className="fadein-fast" size={60} />
            {/* One message for the whole load: a fast local load otherwise flashes past each
                stage and reads as several loading screens. */}
            <Typography role="status">Starting your mission…</Typography>
          </Stack>
        )}
      </div>
    );
  }
}
