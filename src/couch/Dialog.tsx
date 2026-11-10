import { Dialog } from "@mui/material";
import type { DialogProps } from "@mui/material";
import { useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep the controls inside MUI's active modal, with clear space below its actions. */
export default function CouchDialog({
  controls,
  className = "",
  ...props
}: DialogProps & { controls?: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const legend = root?.querySelector<HTMLElement>(".couchControlsLegend");
    if (!root || !legend || !props.open) return;
    const measure = () =>
      root.style.setProperty(
        "--couch-controls-height",
        `${Math.ceil(legend.getBoundingClientRect().height)}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(legend);
    return () => observer.disconnect();
  }, [root, props.open]);
  const paper = root?.querySelector<HTMLElement>('[role="dialog"]');
  return (
    <>
      <Dialog
        {...props}
        ref={setRoot}
        className={`${controls ? "couchDialogWithControls" : ""} ${className}`}
      />
      {props.open && controls && paper ? createPortal(controls, paper) : null}
    </>
  );
}
