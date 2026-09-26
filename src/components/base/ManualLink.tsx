import * as React from "react";
import { useDispatch, useSelector } from "react-redux";
import { Fade, Paper, Popper } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import type { AppDispatch, RootState } from "../../Store";
import { manualHelpOpen } from "../../reducers/UI";
import type { ManualEntryTitleType } from "./ManualEntries";
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
}

// Long enough that sweeping the mouse across a row doesn't flash entries open, short enough
// that resting on the (?) feels like asking
const HOVER_OPEN_MS = 300;
// Grace for crossing the gap between the (?) and the preview, or overshooting its edge
const HOVER_CLOSE_MS = 250;

function isMouse(event: React.PointerEvent): boolean {
  return event.pointerType === "mouse";
}

// A term the game already shows, turned into a way into the manual. Without these the search
// box only helps players who already know the term exists, which is the wrong way round.
//
// With a mouse, resting on the term previews its entry and moving away dismisses it, the way a
// link preview does on Wikipedia. The preview leaves the game running and the rest of the screen
// usable; clicking (or tapping, where there is no hover) pins the entry open instead.
export default function ManualLink(props: Props): React.JSX.Element {
  const dispatch = useDispatch<AppDispatch>();
  const pinned = useSelector((state: RootState) => !!state.ui.manualHelpEntry);
  const label = props.label || props.entry;
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  // Set by a click. Closing the pinned entry takes its backdrop away from under a mouse that
  // hasn't moved, which the browser reports as entering the (?) again; the preview waits until
  // the mouse has actually left instead of popping straight back up
  const suppressed = React.useRef(false);
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

  const pin = (entry: string) => {
    cancel();
    suppressed.current = true;
    setPreview(false);
    setManualHelpAnchor(anchorRef.current);
    dispatch(manualHelpOpen(entry));
  };

  const entry = manualEntryByTitle(props.entry);
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className={props.text ? "manual-link manual-link-text" : "manual-link"}
        aria-label={props.text || `What is ${label}?`}
        onPointerEnter={(event: React.PointerEvent) => {
          if (isMouse(event) && !suppressed.current) {
            schedule(true, HOVER_OPEN_MS);
          }
        }}
        onPointerLeave={(event: React.PointerEvent) => {
          if (!isMouse(event)) return;
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
        {props.text || <HelpOutlineIcon fontSize="inherit" />}
      </button>
      {entry && (
        <Popper
          // A Popper rather than a Popover: nothing modal, so the page underneath keeps its
          // pointer, focus and accessibility tree while the preview is up
          open={preview && !pinned}
          anchorEl={anchorRef.current}
          placement="bottom"
          transition
          sx={{ zIndex: (theme) => theme.zIndex.tooltip }}
          modifiers={[
            { name: "offset", options: { offset: [0, 4] } },
            { name: "preventOverflow", options: { padding: 8 } },
            { name: "flip", options: { padding: 8 } },
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
                // The (?) often sits inside a clickable row, which the preview's own clicks
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
