import * as React from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../../Store";
import { manualHelpOpen } from "../../reducers/UI";
import type { ManualEntryTitleType } from "./ManualEntries";
import { setManualHelpAnchor } from "./ManualHelpPopover";

interface Props {
  entry: ManualEntryTitleType;
  // The term as it reads on screen, if it differs from the entry's title
  label?: string;
  text?: string;
  children?: React.ReactNode;
  // Stretch the native button's hit area over its .manual-help-region parent.
  region?: boolean;
}

// A term the game already shows, turned into a way into the manual. Click, tap or keyboard
// activation opens its entry; hovering only signals that help is available.
export default function ManualLink(props: Props): React.JSX.Element {
  const dispatch = useDispatch<AppDispatch>();
  const label = props.label || props.entry;
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const anchor = () =>
    (props.region &&
      anchorRef.current?.closest<HTMLElement>(".manual-help-region")) ||
    anchorRef.current;
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const touchMoved = React.useRef(false);
  return (
    <button
      type="button"
      ref={anchorRef}
      className={`manual-link${props.text ? " manual-link-text" : " manual-link-label"}${props.region ? " manual-link-region" : ""}`}
      aria-label={props.text || `What is ${label}?`}
      onTouchStart={(event) => {
        const touch = event.touches.length === 1 ? event.touches[0] : undefined;
        touchStart.current = touch
          ? { x: touch.clientX, y: touch.clientY }
          : null;
        touchMoved.current = false;
      }}
      onTouchMove={(event) => {
        const start = touchStart.current;
        const touch = event.touches[0];
        if (
          start &&
          touch &&
          (Math.abs(touch.clientX - start.x) > 10 ||
            Math.abs(touch.clientY - start.y) > 10)
        ) {
          touchMoved.current = true;
        }
      }}
      onTouchEnd={(event) => {
        // Let the catalog handle swipes and the browser handle scrolling, without a
        // synthesized click opening help after the gesture.
        if (touchMoved.current) event.preventDefault();
        touchStart.current = null;
      }}
      onTouchCancel={() => {
        touchStart.current = null;
      }}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        // These sit inside rows that expand when clicked, and looking a term up shouldn't
        // also toggle the row underneath it
        event.stopPropagation();
        setManualHelpAnchor(anchor());
        dispatch(manualHelpOpen(props.entry));
      }}
    >
      {props.children || props.text || label}
    </button>
  );
}
