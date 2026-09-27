import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";

export interface InfoDialogProps {
  open: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  // Replaces the default single "Close" button
  actions?: React.ReactNode;
  titleId?: string;
}

/** A short explanation the player reads and dismisses. */
export default function InfoDialog({
  open,
  title,
  children,
  onClose,
  actions,
  titleId,
}: InfoDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        {actions ?? (
          <Button color="primary" variant="contained" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
