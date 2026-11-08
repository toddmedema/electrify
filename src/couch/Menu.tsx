import { Button, Stack } from "@mui/material";
import type { KeyboardEvent, ReactNode } from "react";
import CouchDialog from "./Dialog";

/** A controller can pause from any company without exposing another navigation bar. */
export default function CouchMenu({
  open,
  controls,
  onClose,
  onManual,
  onSettings,
  onQuit,
}: {
  open: boolean;
  controls?: ReactNode;
  onClose: () => void;
  onManual: () => void;
  onSettings: () => void;
  onQuit: () => void;
}) {
  /** Wrap real focus across menu choices for either keyboard or controller arrow events.
   * Consume only unmodified navigation keys so native confirmation and dialog dismissal stay intact. */
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
    )
      return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = /Up|Left/.test(event.key) ? -1 : 1;
    event.preventDefault();
    event.stopPropagation();
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };
  return (
    <CouchDialog
      open={open}
      controls={controls}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-label="Game menu"
      slotProps={{ paper: { "aria-label": "Game menu" } }}
      className="couchPauseDialog"
    >
      <Stack
        className="couchPauseMenu keyboardMenu"
        spacing={1}
        onKeyDown={navigate}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse")
            (event.target as HTMLElement).closest("button")?.focus();
        }}
      >
        <Button autoFocus size="large" onClick={onClose}>
          Return to game
        </Button>
        <Button size="large" onClick={onManual}>
          Manual
        </Button>
        <Button size="large" onClick={onSettings}>
          Settings
        </Button>
        <Button size="large" onClick={onQuit}>
          Quit
        </Button>
      </Stack>
    </CouchDialog>
  );
}
