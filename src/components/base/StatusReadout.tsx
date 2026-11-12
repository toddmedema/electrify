import * as React from "react";
import { Button, ButtonProps } from "@mui/material";
import ConceptIcon, { ConceptNameType } from "./ConceptIcon";

/** Shared icon, typography and hit area for actionable grid and mission status. */
export default function StatusReadout({
  concept,
  children,
  className = "",
  textClassName = "",
  ...props
}: ButtonProps & {
  concept: ConceptNameType;
  textClassName?: string;
}) {
  return (
    <Button
      type="button"
      color="inherit"
      className={`statusReadout ${className}`}
      {...props}
    >
      <span className="statusIcon" aria-hidden="true">
        <ConceptIcon concept={concept} fontSize="small" decorative />
      </span>
      <span className={`statusReadoutText ${textClassName}`}>{children}</span>
    </Button>
  );
}
