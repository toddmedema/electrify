import * as React from "react";
import { Box, Button, Typography } from "@mui/material";

/** Fullscreen belongs to the current browser session, never to a saved preference. */
export default function FullscreenButton(): React.JSX.Element {
  const [active, setActive] = React.useState(!!document.fullscreenElement);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(false);
  const supported = Boolean(
    document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === "function" &&
    typeof document.exitFullscreen === "function",
  );
  React.useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = async () => {
    setError(false);
    setPending(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setActive(!!document.fullscreenElement);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Box>
      <Button
        variant="outlined"
        disabled={!supported || pending}
        aria-describedby={error ? "fullscreen-error" : undefined}
        onClick={() => void toggle()}
        sx={{ width: { xs: "100%", sm: "auto" } }}
      >
        {active ? "Exit fullscreen" : "Enter fullscreen"}
      </Button>
      {!supported && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Unavailable in this browser.
        </Typography>
      )}
      {error && (
        <Typography
          id="fullscreen-error"
          role="alert"
          variant="body2"
          sx={{ mt: 1 }}
        >
          Fullscreen could not change. Try again or use your browser’s
          fullscreen control.
        </Typography>
      )}
    </Box>
  );
}
