import * as React from "react";
import {
  Button,
  Fade,
  IconButton,
  Paper,
  Popover,
  Popper,
  Typography,
} from "@mui/material";
import CheckCircleOutlineRoundedIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import { useAppSelector } from "../../Store";
import { retryCloudSync } from "../../CloudSaves";

type IndicatorState = "synced" | "syncing" | "offline" | "failed";

type Indicator = {
  icon: typeof SyncRoundedIcon;
  color: string;
  label: string;
  spin?: boolean;
};

// The routine state is the quietest glyph (an outline) and the one that needs the player is the
// heaviest (a filled triangle), so weight follows urgency rather than the green check shouting
const INDICATORS: Record<IndicatorState, Indicator> = {
  synced: {
    icon: CheckCircleOutlineRoundedIcon,
    color: "success.main",
    label: "Cloud backup up to date",
  },
  syncing: {
    icon: SyncRoundedIcon,
    color: "text.secondary",
    label: "Syncing cloud backup",
    spin: true,
  },
  offline: {
    icon: CloudOffRoundedIcon,
    color: "text.secondary",
    label: "Cloud backup offline",
  },
  failed: {
    icon: WarningRoundedIcon,
    color: "var(--warning-icon)",
    label: "Cloud backup couldn't finish",
  },
};

const RETRY_SUCCEEDED = "Cloud backup up to date.";
const FAILED_FALLBACK =
  "Cloud backup couldn't finish. Your device saves are still available.";

// The same rhythm as a manual term's preview (ManualLink): long enough that sweeping past the
// header doesn't flash it open, short enough that resting on the glyph feels like asking
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_MS = 150;

function isMouse(event: React.PointerEvent): boolean {
  return event.pointerType === "mouse";
}

/**
 * Cloud backup state as one glyph beside the screen title, so routine status stays out of the
 * way of the saves themselves. A mouse resting on it previews the explanation; a click or tap
 * pins the same card open in the same place, since touch has no hover; pinned, a failure also
 * offers an immediate retry. Keyboard and screen-reader users get the explanation as the button's
 * description and the card on Enter, so no focus-triggered tooltip pops back up after Escape.
 * Signed out, or before sign-in is known, it shows nothing.
 */
export default function CloudSyncIndicator(): React.JSX.Element | null {
  const {
    cloudState,
    cloudError,
    incompatibleCloudSaves = [],
  } = useAppSelector((state) => state.saves);
  const descriptionId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  // Set by a click. Closing the pinned card takes its backdrop away from under a mouse that
  // hasn't moved, which the browser reports as entering the glyph again; the preview waits until
  // the mouse has actually left instead of popping straight back up
  const suppressed = React.useRef(false);
  // Where the mouse last was while the card was pinned. Escape carries no coordinates, and a
  // mouse still resting on the glyph must not reopen the preview once the backdrop goes
  const pointer = React.useRef<{ x: number; y: number } | null>(null);
  React.useEffect(() => {
    if (!pinned) return;
    const track = (event: PointerEvent) => {
      if (event.pointerType === "mouse")
        pointer.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener("pointermove", track);
    return () => document.removeEventListener("pointermove", track);
  }, [pinned]);
  const cancel = React.useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  React.useEffect(() => cancel, [cancel]);
  const schedule = (show: boolean, ms: number) => {
    cancel();
    timer.current = window.setTimeout(() => setPreview(show), ms);
  };

  const state: IndicatorState | undefined =
    cloudState === "synced" ||
    cloudState === "offline" ||
    cloudState === "failed" ||
    cloudState === "syncing"
      ? cloudState
      : undefined;

  // Routine changes stay silent. A failure is announced once (automatic retries that fail the
  // same way don't repeat it), and so is the outcome of a retry the player asked for
  const [announced, setAnnounced] = React.useState({
    state,
    text: state === "failed" ? cloudError || FAILED_FALLBACK : "",
    retried: false,
  });
  if (announced.state !== state) {
    const text =
      state === "failed"
        ? cloudError || FAILED_FALLBACK
        : state === "synced"
          ? announced.retried
            ? RETRY_SUCCEEDED
            : ""
          : announced.text;
    setAnnounced({
      state,
      text,
      retried:
        state === "synced" || state === "failed" ? false : announced.retried,
    });
    // Signing out mid-read takes the glyph away; it shouldn't come back already open
    if (!state) setPinned(false);
  }

  // Before sign-in is known a spinner would flash at every signed-out player, and signed out
  // the page itself carries the invitation
  if (!state) return null;
  const message =
    state === "synced"
      ? incompatibleCloudSaves.length
        ? "Compatible cloud backups are up to date. Games load from this device."
        : "Cloud backup up to date. Games load from this device."
      : state === "offline"
        ? "You're offline. Games save on this device; cloud backup resumes when you reconnect."
        : state === "failed"
          ? cloudError || FAILED_FALLBACK
          : "Syncing cloud backup. Games load from this device.";
  const { icon: Icon, color, label, spin } = INDICATORS[state];
  const close = () => {
    cancel();
    setPinned(false);
    // Only a mouse left over the glyph has a hover to wait out
    const rect = buttonRef.current?.getBoundingClientRect();
    const at = pointer.current;
    suppressed.current =
      !!rect &&
      !!at &&
      at.x >= rect.left &&
      at.x <= rect.right &&
      at.y >= rect.top &&
      at.y <= rect.bottom;
  };
  const text = <Typography variant="body2">{message}</Typography>;
  const card = (
    <>
      {text}
      {state === "failed" && (
        <Button
          variant="outlined"
          onClick={() => {
            close();
            setAnnounced({ state, text: "", retried: true });
            retryCloudSync();
          }}
          sx={{ alignSelf: "flex-start" }}
        >
          Retry now
        </Button>
      )}
    </>
  );
  return (
    <>
      <IconButton
        ref={buttonRef}
        aria-label={label}
        aria-describedby={descriptionId}
        aria-haspopup="dialog"
        aria-expanded={pinned}
        onPointerEnter={(event) => {
          if (isMouse(event) && !suppressed.current)
            schedule(true, HOVER_OPEN_MS);
        }}
        onPointerLeave={(event) => {
          if (!isMouse(event)) return;
          // The pinned card's backdrop arriving counts as leaving too, and doesn't end it
          if (!pinned) suppressed.current = false;
          schedule(false, HOVER_CLOSE_MS);
        }}
        onClick={(event) => {
          cancel();
          setPreview(false);
          suppressed.current = true;
          const { pointerType } = event.nativeEvent as PointerEvent;
          pointer.current =
            pointerType === "mouse"
              ? { x: event.clientX, y: event.clientY }
              : null;
          setPinned(true);
        }}
        size="large"
        className="cloudSyncIndicator"
        sx={{ color }}
      >
        <Icon className={spin ? "cloudSyncSpin" : undefined} />
      </IconButton>
      <span id={descriptionId} className="srOnly">
        {message}
      </span>
      <span className="srOnly" role="status">
        {announced.text}
      </span>
      <Popper
        // Not modal: the screen keeps its pointer and focus while the mouse rests here. Popper
        // already gives its root role="tooltip"
        open={preview && !pinned}
        anchorEl={buttonRef.current}
        placement="bottom"
        transition
        sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
        modifiers={[
          { name: "offset", options: { offset: [0, 4] } },
          { name: "preventOverflow", options: { padding: 8 } },
        ]}
      >
        {({ TransitionProps }) => (
          <Fade {...TransitionProps} timeout={150}>
            <Paper
              className="cloudSyncCard"
              elevation={8}
              // A preview of the text only: the retry waits for the pinned card, so nothing
              // interactive sits in a surface that vanishes when the mouse wanders
              onPointerEnter={cancel}
              onPointerLeave={(event) => {
                if (isMouse(event)) schedule(false, HOVER_CLOSE_MS);
              }}
            >
              {text}
            </Paper>
          </Fade>
        )}
      </Popper>
      <Popover
        open={pinned}
        anchorEl={buttonRef.current}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        marginThreshold={8}
        slotProps={{
          paper: {
            className: "cloudSyncCard cloudSyncCardPinned",
            role: "dialog",
            "aria-label": label,
          },
        }}
      >
        {card}
      </Popover>
    </>
  );
}
