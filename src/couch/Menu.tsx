import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import CouchDialog from "./Dialog";

/** A controller can pause from any company without exposing another navigation bar. */
export default function CouchMenu({
  open,
  controls,
  clockDetails,
  clockStyle,
  onClose,
  onManual,
  onSettings,
  onQuit,
}: {
  open: boolean;
  controls?: ReactNode;
  clockDetails: ReactNode;
  clockStyle: CSSProperties;
  onClose: () => void;
  onManual: () => void;
  onSettings: () => void;
  onQuit: () => void;
}) {
  const [view, setView] = useState<"menu" | "clock" | "back">("menu");
  const clockOpen = view === "clock";
  const clockBody = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) setView("menu");
  }, [open]);
  const backToMenu = () => setView("back");
  const title = clockOpen ? "Clock status" : "Game menu";

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
      onClose={clockOpen ? backToMenu : onClose}
      fullWidth
      maxWidth={clockOpen ? "sm" : "xs"}
      slotProps={{
        paper: {
          "aria-label": title,
          style: clockOpen ? clockStyle : undefined,
        },
      }}
      className={clockOpen ? "couchClockDialog" : "couchPauseDialog"}
    >
      {clockOpen ? (
        <>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent ref={clockBody}>{clockDetails}</DialogContent>
          <DialogActions>
            <Button
              autoFocus
              onClick={backToMenu}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                  return;
                event.preventDefault();
                // Controller arrow events have no native scrolling default.
                clockBody.current?.scrollBy(
                  0,
                  event.key === "ArrowUp" ? -48 : 48,
                );
              }}
            >
              Back to game menu
            </Button>
          </DialogActions>
        </>
      ) : (
        <Stack
          className="couchPauseMenu keyboardMenu"
          spacing={1}
          onKeyDown={navigate}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse")
              (event.target as HTMLElement).closest("button")?.focus();
          }}
        >
          <Button autoFocus={view === "menu"} size="large" onClick={onClose}>
            Return to game
          </Button>
          <Button size="large" onClick={onManual}>
            Manual
          </Button>
          <Button size="large" onClick={onSettings}>
            Settings
          </Button>
          <Button
            autoFocus={view === "back"}
            size="large"
            onClick={() => setView("clock")}
          >
            Clock status
          </Button>
          <Button size="large" onClick={onQuit}>
            Quit
          </Button>
        </Stack>
      )}
    </CouchDialog>
  );
}
