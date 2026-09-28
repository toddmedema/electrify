import * as React from "react";
import { Button } from "@mui/material";
import DecisionDialog from "./DecisionDialog";

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
    <DecisionDialog
      open={open}
      onClose={onClose}
      title={title}
      titleId={titleId}
      actions={
        actions ?? (
          <Button color="primary" variant="contained" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {children}
    </DecisionDialog>
  );
}
