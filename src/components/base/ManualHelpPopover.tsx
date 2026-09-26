import * as React from "react";
import { Button, IconButton, Popover, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { MANUAL_ENTRIES, ManualEntryType } from "./ManualEntries";

// The (?) the player tapped. A DOM node has no place in the store, so it lives here beside the
// popover that reads it; ManualLink records it just before asking for the entry
let helpAnchor: HTMLElement | null = null;

export function setManualHelpAnchor(el: HTMLElement | null) {
  helpAnchor = el;
}

const ENTRIES_BY_TITLE: Record<string, ManualEntryType> = {};
MANUAL_ENTRIES.forEach((entry: ManualEntryType) => {
  ENTRIES_BY_TITLE[entry.title] = entry;
});

interface Props {
  // The entry to show, or undefined when closed
  entry?: string;
  onClose: () => void;
  onRelated: (title: string) => void;
}

// A term's manual entry, beside the term. The full-screen manual took the player out of the
// decision they were in the middle of; this keeps it on screen, capped at half the viewport so
// the choice underneath stays readable, and a tap anywhere outside puts it away
export default function ManualHelpPopover(
  props: Props,
): React.JSX.Element | null {
  const { onClose, onRelated } = props;
  // Kept through the exit transition, so the content doesn't blank out as it fades
  const [shown, setShown] = React.useState(props.entry);
  if (props.entry && props.entry !== shown) {
    setShown(props.entry);
  }
  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    // A related entry replaces this one in place, and should start at its top
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [shown]);

  const entry = shown ? ENTRIES_BY_TITLE[shown] : undefined;
  const open = !!props.entry && !!entry;
  // A row can re-render its (?) away while the entry is open. Without a node still on the page
  // to point at, the popover centres itself instead of flying to the corner
  const anchored = !!helpAnchor?.isConnected;

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorEl={anchored ? helpAnchor : null}
      anchorReference={anchored ? "anchorEl" : "anchorPosition"}
      anchorPosition={{
        top: window.innerHeight / 2,
        left: window.innerWidth / 2,
      }}
      anchorOrigin={
        anchored
          ? { vertical: "bottom", horizontal: "center" }
          : { vertical: "center", horizontal: "center" }
      }
      transformOrigin={
        anchored
          ? { vertical: "top", horizontal: "center" }
          : { vertical: "center", horizontal: "center" }
      }
      marginThreshold={8}
      data-manual-help="true"
      slotProps={{
        paper: {
          className: "manual-popover",
          role: "dialog",
          "aria-label": "Manual help",
        },
      }}
    >
      {entry && (
        <>
          <div className="manual-popover-header">
            <Typography variant="subtitle1" component="h2">
              {entry.title}
            </Typography>
            <IconButton
              onClick={onClose}
              aria-label="close"
              color="primary"
              size="small"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>
          <div className="manual-popover-body" ref={scrollRef}>
            {entry.entry}
            {!!entry.related?.length && (
              <nav
                aria-label={`Related to ${entry.title}`}
                className="manual-related"
              >
                <Typography variant="body2" color="textSecondary">
                  Related entries
                </Typography>
                {entry.related.map((title) => (
                  <Button
                    key={title}
                    className="manual-related-link"
                    onClick={() => onRelated(title)}
                  >
                    {title}
                  </Button>
                ))}
              </nav>
            )}
          </div>
        </>
      )}
    </Popover>
  );
}
