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
  ...props
}: DialogTitleProps & {
  onClose: IconButtonProps["onClick"];
}): React.JSX.Element {
  return (
    <DialogTitle
      {...props}
      className={["closableDialogTitle", className].filter(Boolean).join(" ")}
    >
      <span className="closableDialogTitleText">{children}</span>
      <IconButton aria-label="close" onClick={onClose} size="large">
        <CloseIcon />
      </IconButton>
    </DialogTitle>
  );
}
