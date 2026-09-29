import * as React from "react";
import { Button } from "@mui/material";
import DecisionDialog from "./DecisionDialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  // Renders the confirm action in the error color, for choices that throw something away
  destructive?: boolean;
  // A dialog opened from inside a clickable row portals out of the DOM but not out of React's
  // event tree, so without this every click in it also lands on the row behind it
  isolateClicks?: boolean;
  contentClassName?: string;
}

/** A yes/no question: a title, some context, a quiet way out and one focused way forward. */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onCancel,
  onConfirm,
  confirmDisabled,
  destructive,
  isolateClicks,
  contentClassName,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <DecisionDialog
      open={open}
      onClose={onCancel}
      title={title}
      isolateClicks={isolateClicks}
      contentClassName={contentClassName}
      actions={
        <>
          <Button onClick={onCancel} color="primary" autoFocus={destructive}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            color={destructive ? "error" : "primary"}
            variant="contained"
            autoFocus={!destructive}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </DecisionDialog>
  );
}
