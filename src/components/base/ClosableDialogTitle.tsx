import * as React from "react";
import {
  DialogTitle,
  DialogTitleProps,
  IconButton,
  IconButtonProps,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

/** Keep the title and close control in separate columns when the title wraps. */
export default function ClosableDialogTitle({
  children,
  onClose,
  className,
  id,
  closeDisabled,
  ...props
}: DialogTitleProps & {
  onClose: IconButtonProps["onClick"];
  closeDisabled?: boolean;
}): React.JSX.Element {
  return (
    <DialogTitle
      {...props}
      id={id ? `${id}-heading` : undefined}
      className={["closableDialogTitle", className].filter(Boolean).join(" ")}
    >
      <span id={id} className="closableDialogTitleText">
        {children}
      </span>
      <IconButton
        aria-label="close"
        onClick={onClose}
        disabled={closeDisabled}
        size="large"
      >
        <CloseIcon />
      </IconButton>
    </DialogTitle>
  );
}
