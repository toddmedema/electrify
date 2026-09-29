import * as React from "react";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogProps,
  DialogTitle,
} from "@mui/material";
import ClosableDialogTitle from "./ClosableDialogTitle";

interface DecisionDialogProps {
  open: boolean;
  title: React.ReactNode;
  titleId?: string;
  onClose: () => void;
  children?: React.ReactNode;
  actions: React.ReactNode;
  closable?: boolean;
  isolateClicks?: boolean;
  contentClassName?: string;
  fullWidth?: boolean;
  maxWidth?: DialogProps["maxWidth"];
}

/** Shared accessible frame for a short explanation or decision. */
export default function DecisionDialog({
  title,
  titleId,
  onClose,
  children,
  actions,
  closable,
  isolateClicks,
  contentClassName,
  ...props
}: DecisionDialogProps): React.JSX.Element {
  const generatedTitleId = React.useId();
  const headingId = titleId ?? generatedTitleId;
  return (
    <Dialog
      {...props}
      onClose={onClose}
      aria-labelledby={headingId}
      onClick={isolateClicks ? (event) => event.stopPropagation() : undefined}
    >
      {closable ? (
        <ClosableDialogTitle id={headingId} onClose={onClose}>
          {title}
        </ClosableDialogTitle>
      ) : (
        <DialogTitle id={headingId}>{title}</DialogTitle>
      )}
      {children && (
        <DialogContent className={contentClassName}>{children}</DialogContent>
      )}
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  );
}
