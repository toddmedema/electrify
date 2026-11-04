import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { useDesktopState } from "../../DesktopState";
import { useAppDispatch, useAppSelector } from "../../Store";
import { change } from "../../reducers/Settings";
import { useRef } from "react";

/** Mounted only on the desktop title screen, before starting a game. */
export default function TvModeSuggestion() {
  const desktop = useDesktopState();
  const choice = useAppSelector((state) => state.settings.tvMode);
  const onTitleScreen = useAppSelector(
    (state) => state.card.name === "MAIN_MENU",
  );
  const dispatch = useAppDispatch();
  const primary = useRef<HTMLButtonElement>(null);
  const signals = desktop?.steam.presentation;
  const remoteTv = signals?.remotePlayTv === true;
  // Big Picture also serves handheld players. Unknown hardware is deliberately
  // conservative; a docked Deck can still select TV layout from the title screen.
  const suggest =
    desktop?.steam.available === true &&
    (remoteTv || (signals?.bigPicture === true && signals.steamDeck === false));
  const choose = (tvMode: boolean) => dispatch(change({ tvMode }));
  return (
    <Dialog
      open={onTitleScreen && choice === undefined && suggest}
      onClose={() => choose(false)}
      maxWidth={false}
      aria-labelledby="tv-suggestion-title"
      aria-describedby="tv-suggestion-description"
      slotProps={{
        transition: {
          onEntered: () => {
            const dialog = primary.current?.closest('[role="dialog"]');
            // Startup can leave MUI's focus trap on the dialog surface. Once it is
            // visible, offer the primary choice without undoing a player's movement.
            if (
              onTitleScreen &&
              choice === undefined &&
              (document.activeElement === dialog ||
                document.activeElement === document.body)
            )
              primary.current?.focus({ preventScroll: true });
          },
        },
      }}
      sx={{
        // Readable before TV scaling is enabled, with matching density at 1080p/4K.
        "--tv-suggestion-unit": "clamp(20px, 2.222222vh, 48px)",
        "& .MuiDialog-paper": {
          width:
            "min(calc(100vw - 48px), calc(var(--tv-suggestion-unit) * 40))",
          margin: "24px",
          fontSize: "var(--tv-suggestion-unit)",
        },
        "& .MuiDialogTitle-root": {
          fontSize: "calc(var(--tv-suggestion-unit) * 1.333333)",
          lineHeight: 1.3,
          padding:
            "var(--tv-suggestion-unit) calc(var(--tv-suggestion-unit) * 1.333333)",
        },
        "& .MuiDialogContent-root": {
          padding: "0 calc(var(--tv-suggestion-unit) * 1.333333)",
        },
        "& .MuiDialogContentText-root": {
          fontSize: "inherit",
          lineHeight: 1.5,
        },
        "& .MuiDialogActions-root": {
          padding:
            "var(--tv-suggestion-unit) calc(var(--tv-suggestion-unit) * 1.333333)",
        },
        "& .MuiButton-root": {
          fontSize: "inherit",
          minHeight: "calc(var(--tv-suggestion-unit) * 2.5)",
          paddingInline: "var(--tv-suggestion-unit)",
        },
      }}
    >
      <DialogTitle id="tv-suggestion-title">Playing on a TV?</DialogTitle>
      <DialogContent>
        <DialogContentText id="tv-suggestion-description">
          {remoteTv
            ? "Steam Remote Play is connected to a TV."
            : "Steam is using Big Picture."}{" "}
          TV layout makes text and controls larger for playing from the couch.
        </DialogContentText>
        <DialogContentText sx={{ mt: 2 }}>
          Your choice is saved on this device. Change it anytime in Settings.
        </DialogContentText>
      </DialogContent>
      <DialogActions disableSpacing sx={{ flexWrap: "wrap", gap: "0.5em" }}>
        <Button disableFocusRipple onClick={() => choose(false)}>
          Keep desktop layout
        </Button>
        <Button
          ref={primary}
          disableFocusRipple
          variant="contained"
          autoFocus
          onClick={() => choose(true)}
        >
          Use TV layout
        </Button>
      </DialogActions>
    </Dialog>
  );
}
