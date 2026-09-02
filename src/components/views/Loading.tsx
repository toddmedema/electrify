import * as React from "react";
import { Button, CircularProgress, Stack, Typography } from "@mui/material";
import { GameType } from "../../Types";

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  load: (
    game: GameType,
    onProgress: (message: string) => void,
    onError: (message: string) => void,
  ) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface LoadingState {
  error?: string;
  progress: string;
}

export default class Loading extends React.PureComponent<Props, LoadingState> {
  public state: LoadingState = { progress: "Preparing your grid…" };
  private mounted = false;

  public componentDidMount() {
    this.mounted = true;
    this.beginLoad();
  }

  public componentWillUnmount() {
    this.mounted = false;
  }

  private beginLoad = () => {
    this.setState({ error: undefined, progress: "Preparing your grid…" });
    this.props.load(
      this.props.game,
      (progress) => this.mounted && this.setState({ progress }),
      (error) => this.mounted && this.setState({ error }),
    );
  };

  public render() {
    return (
      <div className="flex-fully-centered">
        <div id="logo" className="fadein-slow">
          <img src="images/logo.svg" alt="Logo"></img>
        </div>
        {this.state.error ? (
          <Stack spacing={2} sx={{ px: 3, textAlign: "center", maxWidth: 420 }}>
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
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ alignItems: "center" }}>
            <CircularProgress className="fadein-fast" size={60} />
            <Typography role="status">{this.state.progress}</Typography>
          </Stack>
        )}
      </div>
    );
  }
}
