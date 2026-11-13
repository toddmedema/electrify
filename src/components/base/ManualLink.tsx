import * as React from "react";
import { useDispatch, useSelector } from "react-redux";
import { Fade, Paper, Popper } from "@mui/material";
import type { AppDispatch, RootState } from "../../Store";
import { manualHelpOpen } from "../../reducers/UI";
import type { ManualEntryTitleType } from "./ManualEntries";
import { useScreenEdgeMargin } from "../../ScreenEdgePadding";
import {
  ManualHelpContent,
  manualEntryByTitle,
  setManualHelpAnchor,
} from "./ManualHelpPopover";

interface Props {
  entry: ManualEntryTitleType;
  // The term as it reads on screen, if it differs from the entry's title
  label?: string;
  text?: string;
  children?: React.ReactNode;
  // Stretch the native button's hit area over its .manual-help-region parent.
  region?: boolean;
}

// Long enough that sweeping the mouse across a row doesn't flash entries open, short enough
// that resting on the term feels like asking
const HOVER_OPEN_MS = 300;
// Grace for crossing the gap between the term and the preview, or overshooting its edge
const HOVER_CLOSE_MS = 250;

function isMouse(event: React.PointerEvent): boolean {
  return event.pointerType === "mouse";
}

// A term the game already shows, turned into a way into the manual. Without these the search
// box only helps players who already know the term exists, which is the wrong way round.
//
// With a mouse, moving onto the term and resting there previews its entry and moving away dismisses it, the way a
// link preview does on Wikipedia. The preview leaves the game running and the rest of the screen
// usable; clicking (or tapping, where there is no hover) pins the entry open instead.
export default function ManualLink(props: Props): React.JSX.Element {
  const dispatch = useDispatch<AppDispatch>();
  const edgeMargin = useScreenEdgeMargin();
  const pinned = useSelector((state: RootState) => !!state.ui.manualHelpEntry);
  const label = props.label || props.entry;
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const anchor = () =>
    (props.region &&
      anchorRef.current?.closest<HTMLElement>(".manual-help-region")) ||
    anchorRef.current;
  const [preview, setPreview] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  // Set by a click. Closing the pinned entry takes its backdrop away from under a mouse that
  // hasn't moved, which the browser reports as entering the term again; the preview waits until
  // the mouse has actually left instead of popping straight back up
  const suppressed = React.useRef(false);
  // Set once a moving mouse has asked for the preview. Boundary events alone can't do that: a
  // dialog can open with its term beneath a mouse that hasn't moved, which still reports entering.
  const hovering = React.useRef(false);
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const touchMoved = React.useRef(false);
  const pinnedRef = React.useRef(pinned);
  pinnedRef.current = pinned;

  const cancel = React.useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const schedule = (show: boolean, ms: number) => {
    cancel();
    timer.current = window.setTimeout(() => setPreview(show), ms);
  };
  React.useEffect(() => cancel, [cancel]);

  React.useEffect(() => {
    if (!preview || pinned) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      suppressed.current = hovering.current;
      setPreview(false);
    };
    // Focus may still be in the workspace; consume Escape before its document listener.
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [preview, pinned, cancel]);

  const pin = (entry: string) => {
    cancel();
    suppressed.current = true;
    setPreview(false);
    setManualHelpAnchor(anchor());
    dispatch(manualHelpOpen(entry));
  };

  const entry = manualEntryByTitle(props.entry);
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className={`manual-link${props.text ? " manual-link-text" : " manual-link-label"}${props.region ? " manual-link-region" : ""}`}
        aria-label={props.text || `What is ${label}?`}
        onTouchStart={(event) => {
          const touch =
            event.touches.length === 1 ? event.touches[0] : undefined;
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
        onPointerMove={(event: React.PointerEvent) => {
          if (isMouse(event) && !suppressed.current && !hovering.current) {
            hovering.current = true;
            schedule(true, HOVER_OPEN_MS);
          }
        }}
        onPointerLeave={(event: React.PointerEvent) => {
          if (!isMouse(event)) return;
          hovering.current = false;
          // The pinned entry's backdrop arriving counts as leaving too, and doesn't end it
          if (!pinnedRef.current) suppressed.current = false;
          schedule(false, HOVER_CLOSE_MS);
        }}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          // These sit inside rows that expand when clicked, and looking a term up shouldn't
          // also toggle the row underneath it
          event.stopPropagation();
          pin(props.entry);
        }}
      >
        {props.children || props.text || label}
      </button>
      {entry && (
        <Popper
          // A Popper rather than a Popover: nothing modal, so the page underneath keeps its
          // pointer, focus and accessibility tree while the preview is up
          open={preview && !pinned}
          anchorEl={anchor()}
          placement="bottom"
          transition
          sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
          modifiers={[
            { name: "offset", options: { offset: [0, 4] } },
            { name: "preventOverflow", options: { padding: edgeMargin } },
            { name: "flip", options: { padding: edgeMargin } },
          ]}
        >
          {({ TransitionProps }) => (
            <Fade {...TransitionProps} timeout={150}>
              <Paper
                className="manual-popover"
                elevation={8}
                role="dialog"
                aria-label="Manual preview"
                onPointerEnter={cancel}
                onPointerLeave={(event: React.PointerEvent) => {
                  if (isMouse(event)) schedule(false, HOVER_CLOSE_MS);
                }}
                // The term often sits inside a clickable row, which the preview's own clicks
                // (scrolling, a related entry) shouldn't reach through the React tree
                onClick={(event: React.MouseEvent) => event.stopPropagation()}
              >
                <ManualHelpContent
                  entry={entry}
                  onClose={() => {
                    cancel();
                    setPreview(false);
                  }}
                  onRelated={pin}
                />
              </Paper>
            </Fade>
          )}
        </Popper>
      )}
    </>
  );
}
