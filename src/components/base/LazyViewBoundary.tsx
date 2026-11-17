import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";

class ViewDownloadError extends Error {
  constructor(readonly retry: () => void) {
    super("Screen download unavailable");
  }
}

/** Recreate only the rejected lazy type; React otherwise caches its rejected promise. */
export function lazyView<View extends Exclude<React.ElementType, string>>(
  load: () => Promise<{ default: View }>,
): React.ComponentType<React.ComponentPropsWithoutRef<View>> {
  const createView = () =>
    React.lazy(() =>
      load().catch(() => {
        throw new ViewDownloadError(() => {
          Component = createView();
        });
      }),
    );
  let Component = createView();
  return (props) => React.createElement(Component, props);
}

/** A failed optional screen must leave the app, its providers and other panes mounted. */
export default class LazyViewBoundary extends React.Component<
  {
    children: React.ReactNode;
    onClose: () => void;
    closeLabel: string;
  },
  { error?: Error }
> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Dialog
        open
        onClose={this.props.onClose}
        aria-label="This screen couldn't load"
      >
        <DialogTitle>This screen couldn't load</DialogTitle>
        <DialogContent>Check your connection and try again.</DialogContent>
        <DialogActions>
          <Button onClick={this.props.onClose}>{this.props.closeLabel}</Button>
          {error instanceof ViewDownloadError ? (
            <Button
              variant="contained"
              onClick={() => {
                error.retry();
                this.setState({ error: undefined });
              }}
            >
              Retry
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => window.location.reload()}
            >
              Reload Electrify
            </Button>
          )}
        </DialogActions>
      </Dialog>
    );
  }
}
