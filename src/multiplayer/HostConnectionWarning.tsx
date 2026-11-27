import { useEffect, useRef, useState } from "react";
import { focusInitialDialogAction } from "../components/base/dialogFocus";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";

export default function HostConnectionWarning({
  open,
  endReason,
  rollback,
  waiting,
  synchronizing,
  error,
  onReconnect,
  onReturnToMenu,
}: {
  open: boolean;
  endReason?: "checkpoint" | "roomUnavailable";
  rollback: boolean;
  waiting: boolean;
  synchronizing?: boolean;
  error?: string;
  onReconnect: () => Promise<void>;
  onReturnToMenu?: () => Promise<void>;
}) {
  const [action, setAction] = useState<"reconnect" | "leave">();
  const activeAction = useRef<typeof action>();
  const [actionError, setActionError] = useState<string>();
  const menuOnly = !!endReason;
  // When the current session ends during a retry, the Reconnect button disappears.
  useEffect(() => {
    if (!open || !menuOnly) return;
    const dialog = document
      .getElementById("multiplayer-interruption-title")
      ?.closest<HTMLElement>('[role="dialog"]');
    const active = document.activeElement;
    if (
      active === document.body ||
      active === document.documentElement ||
      active === dialog
    )
      focusInitialDialogAction(dialog ?? null);
  }, [open, menuOnly]);
  useEffect(() => {
    if (!open && actionError) setActionError(undefined);
  }, [open, actionError]);

  const syncing = synchronizing && !waiting && !error && !actionError;
  const status =
    action === "leave"
      ? "Returning to the main menu…"
      : menuOnly
        ? actionError
        : action === "reconnect"
          ? "Reconnecting…"
          : actionError ||
            error ||
            (syncing
              ? "Synchronizing with the host…"
              : "Waiting for the host.");

  function act(next: NonNullable<typeof action>, run: () => Promise<void>) {
    if (activeAction.current || (next === "reconnect" && syncing)) return;
    activeAction.current = next;
    setAction(next);
    setActionError(undefined);
    void run()
      .catch(() => {
        setActionError(
          next === "reconnect"
            ? "Could not reconnect. Try again."
            : "Could not return to the main menu. Try again.",
        );
      })
      .finally(() => {
        activeAction.current = undefined;
        setAction(undefined);
      });
  }

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="xs"
      aria-labelledby="multiplayer-interruption-title"
      aria-describedby={
        menuOnly
          ? "multiplayer-interruption-description"
          : "multiplayer-interruption-status multiplayer-interruption-description"
      }
      onClose={() => {}}
      slotProps={{
        transition: {
          onEntered: (node: HTMLElement) => {
            // Replace MUI's container autofocus, preserving navigation during the animation.
            focusInitialDialogAction(node);
          },
        },
      }}
    >
      <DialogTitle id="multiplayer-interruption-title">
        {menuOnly ? "Multiplayer session ended" : "Multiplayer connection"}
      </DialogTitle>
      <DialogContent>
        <Typography
          id="multiplayer-interruption-status"
          role="status"
          sx={status ? { mb: 1.5 } : undefined}
        >
          {status}
        </Typography>
        <Typography id="multiplayer-interruption-description">
          {endReason === "checkpoint"
            ? "Host a game from Play with friends, then choose Load multiplayer save to continue from the last confirmed save."
            : endReason === "roomUnavailable"
              ? "The multiplayer room is no longer available. Host a game from Play with friends, then choose Load multiplayer save."
              : syncing
                ? "The game will continue once it has the latest state from the host."
                : "Reconnect to continue this session."}
          {endReason === "checkpoint" &&
            rollback &&
            " Changes since that save will be lost."}
          {!menuOnly && onReturnToMenu && (
            <>
              {" Leaving now won't create a new save. Progress may be lost."}
              {
                " Host a game from Play with friends, then choose Load multiplayer save."
              }
            </>
          )}
        </Typography>
      </DialogContent>
      <DialogActions
        disableSpacing
        sx={{
          gap: 1,
          flexWrap: "wrap",
          "& .MuiButton-root": {
            minHeight: 40,
            "@media (pointer: coarse)": { minHeight: 44 },
            "&[aria-disabled=true]": { opacity: 0.6, cursor: "default" },
          },
        }}
      >
        {onReturnToMenu && (
          <Button
            variant={menuOnly ? "contained" : "text"}
            aria-disabled={!!action}
            onClick={() => act("leave", onReturnToMenu)}
          >
            Return to main menu
          </Button>
        )}
        {!menuOnly && (
          <Button
            variant="contained"
            aria-disabled={!!action || syncing}
            onClick={() => act("reconnect", onReconnect)}
          >
            Reconnect
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
