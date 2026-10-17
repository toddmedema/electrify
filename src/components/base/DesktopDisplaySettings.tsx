import { useEffect, useRef, useState } from "react";
import { Alert, Box, Switch, Typography } from "@mui/material";
import { DesktopDisplay, getDesktop } from "../../Desktop";
import { useDesktopState } from "../../DesktopState";

const sameDisplay = (left: DesktopDisplay, right: DesktopDisplay) =>
  left.fullscreen === right.fullscreen &&
  left.width === right.width &&
  left.height === right.height;

export default function DesktopDisplaySettings(): React.JSX.Element {
  const state = useDesktopState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<DesktopDisplay>();
  const applying = useRef(false);
  const intended = useRef<DesktopDisplay>();
  const queued = useRef<DesktopDisplay>();
  const display = choice || state?.display;
  useEffect(() => {
    // Native shortcuts and monitor changes take over once our own request has settled.
    if (!applying.current) {
      intended.current = undefined;
      setChoice(undefined);
    }
  }, [state?.display]);
  const change = async (
    next: Partial<Pick<DesktopDisplay, "fullscreen" | "width" | "height">>,
  ) => {
    if (!display) return;
    const current = intended.current || display;
    const wanted = { ...current, ...next };
    if (sameDisplay(current, wanted)) return;
    intended.current = wanted;
    queued.current = wanted;
    setChoice(wanted);
    setError("");
    if (applying.current) return;
    applying.current = true;
    setBusy(true);
    let confirmed = display;
    try {
      const desktop = getDesktop();
      if (!desktop)
        throw new Error("The native display service is unavailable.");
      while (queued.current) {
        const requested = queued.current;
        queued.current = undefined;
        confirmed = await desktop.setDisplay(requested);
        // A later input wins over the earlier response until it has also been applied.
        // Input callbacks can populate the ref during the native await.
        const waiting = queued.current as DesktopDisplay | undefined;
        const following =
          waiting && !sameDisplay(waiting, confirmed) ? waiting : undefined;
        queued.current = following;
        intended.current = following
          ? { ...confirmed, ...following, resolutions: confirmed.resolutions }
          : confirmed;
        setChoice(intended.current);
      }
    } catch {
      try {
        // Applying and rolling back can both fail; ask native for the actual OS state.
        confirmed = (await getDesktop()?.getState())?.display || confirmed;
      } catch {
        /* Keep the last confirmed display when the native state cannot be read. */
      }
      queued.current = undefined;
      intended.current = confirmed;
      setChoice(confirmed);
      setError("Couldn't change the display. Try again.");
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Box
        className="settingsRow"
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 2,
          alignItems: "center",
          p: 2,
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 600 }}>Fullscreen</Typography>
          <Typography variant="body2" color="text.secondary">
            Use the monitor's native resolution. F11 or Alt+Enter also toggles
            fullscreen.
          </Typography>
        </Box>
        <Switch
          sx={{
            height: 44,
            padding: "15px 12px",
            "& .MuiSwitch-switchBase": { padding: "12px 9px" },
          }}
          checked={display?.fullscreen || false}
          disabled={!display}
          slotProps={{
            input: { "aria-label": "Fullscreen", "aria-busy": busy },
          }}
          onChange={(_event, fullscreen) => void change({ fullscreen })}
        />
      </Box>
      {/* Fullscreen always uses the monitor's native resolution, so the window size only
          matters (and only appears) in windowed mode. */}
      {display && !display.fullscreen && (
        <Box
          className="settingsRow"
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(0, 1fr) auto",
            },
            gap: 1.5,
            alignItems: "center",
            p: 2,
          }}
        >
          <Box>
            <Typography
              component="label"
              htmlFor="desktop-resolution"
              sx={{ fontWeight: 600 }}
            >
              Window resolution
            </Typography>
            <Typography
              id="desktop-resolution-help"
              variant="body2"
              color="text.secondary"
            >
              Display choices are saved for your next launch.
            </Typography>
          </Box>
          <select
            id="desktop-resolution"
            aria-label="Resolution"
            aria-describedby="desktop-resolution-help"
            aria-busy={busy}
            value={`${display.width}x${display.height}`}
            onChange={(event) => {
              const [width, height] = event.target.value.split("x").map(Number);
              void change({ width, height });
            }}
            style={{
              minHeight: 44,
              padding: "8px 12px",
              borderRadius: 4,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-raised)",
              color: "var(--interactive-strong)",
              font: "inherit",
              maxWidth: "100%",
            }}
          >
            {display.resolutions.map(({ width, height }) => (
              <option key={`${width}x${height}`} value={`${width}x${height}`}>
                {width} × {height}
              </option>
            ))}
          </select>
        </Box>
      )}
      {error && (
        <Alert severity="error" role="alert" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}
    </>
  );
}
