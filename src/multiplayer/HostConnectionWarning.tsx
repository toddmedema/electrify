import { useEffect, useRef, useState } from "react";
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
  checkpointOnly,
  rollback,
  waiting,
  synchronizing,
  error,
  onReconnect,
  onReturnToMenu,
}: {
  open: boolean;
  checkpointOnly: boolean;
  rollback: boolean;
  waiting: boolean;
  synchronizing?: boolean;
  error?: string;
  onReconnect: () => Promise<void>;
  onReturnToMenu?: () => Promise<void>;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const [action, setAction] = useState<"reconnect" | "leave">();
  const activeAction = useRef<typeof action>();
  const [actionError, setActionError] = useState<string>();
  // When the current session ends during a retry, the Reconnect button disappears.
  useEffect(() => {
    if (
      open &&
      checkpointOnly &&
      (document.activeElement === document.body ||
        document.activeElement === title.current?.closest('[role="dialog"]'))
    )
      title.current?.focus();
  }, [open, checkpointOnly]);
  useEffect(() => {
    if (!open && actionError) setActionError(undefined);
  }, [open, actionError]);

  const syncing = synchronizing && !waiting && !error && !actionError;
  const status =
    action === "leave"
      ? "Returning to the main menu…"
      : checkpointOnly
        ? actionError
        : action === "reconnect"
          ? "Reconnecting…"
          : actionError ||
            error ||
            (syncing ? "Synchronizing with the host…" : undefined);

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
      aria-describedby="multiplayer-interruption-description"
      onClose={() => {}}
      slotProps={{
        transition: {
          onEntered: () => {
            if (
              document.activeElement ===
              title.current?.closest('[role="dialog"]')
            ) {
              title.current?.focus();
            }
          },
        },
      }}
    >
      <DialogTitle
        id="multiplayer-interruption-title"
        ref={title}
        tabIndex={-1}
      >
        {checkpointOnly
          ? "Multiplayer session ended"
          : "Multiplayer connection"}
      </DialogTitle>
      <DialogContent>
        <Typography id="multiplayer-interruption-description">
          {checkpointOnly
            ? "Open Play with friends → Multiplayer saves to continue from the last confirmed save."
            : syncing
              ? "The game will continue once it has the latest state from the host."
              : error || actionError
                ? "The connection to the host was interrupted. Reconnect to continue this session."
                : "Waiting for the host. Reconnect to continue this session."}
          {checkpointOnly &&
            rollback &&
            " Changes since that save will be lost."}
          {!checkpointOnly && onReturnToMenu && (
            <>
              {" Leaving now won't create a new save. Progress may be lost."}
              {
                " Check Play with friends → Multiplayer saves from the main menu."
              }
            </>
          )}
        </Typography>
        <Typography role="status" sx={status ? { mt: 1.5 } : undefined}>
          {status}
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
            variant={checkpointOnly ? "contained" : "text"}
            aria-disabled={!!action}
            onClick={() => act("leave", onReturnToMenu)}
          >
            Return to main menu
          </Button>
        )}
        {!checkpointOnly && (
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
