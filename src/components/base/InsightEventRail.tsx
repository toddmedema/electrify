import * as React from "react";
import {
  Button,
  ClickAwayListener,
  Paper,
  Popper,
  Typography,
} from "@mui/material";
import { UpcomingStoryEventType } from "../views/StoryEventSelectors";

interface Props {
  events: UpcomingStoryEventType[];
  activeKey?: string;
  onActiveChange: (key?: string) => void;
  onZoom: (event: UpcomingStoryEventType) => void;
  /** False for a rail hidden under another that shows the same events' details. */
  showDetails?: boolean;
  /** Open details in place instead of on the page, so a dialog's focus trap keeps them. */
  disablePortal?: boolean;
}

export default function InsightEventRail(props: Props): React.JSX.Element {
  const {
    events,
    activeKey,
    onActiveChange,
    onZoom,
    showDetails = true,
    disablePortal = false,
  } = props;
  const selected = events.find((event) => event.key === activeKey);
  const chips = React.useRef(new Map<string, HTMLButtonElement>());
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setAnchor(activeKey ? chips.current.get(activeKey) || null : null);
  }, [activeKey, events]);

  const focusDetails = React.useCallback((element: HTMLDivElement | null) => {
    element?.focus();
  }, []);

  const closeDetails = (restoreFocus = false) => {
    if (restoreFocus && anchor?.isConnected) anchor.focus();
    setAnchor(null);
    onActiveChange(undefined);
  };

  return (
    <section
      className="insightEventRail"
      aria-label="Upcoming scenario events"
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Escape" && selected && showDetails) {
          keyEvent.preventDefault();
          // Closes the details only, not a full-screen chart this rail sits in
          keyEvent.stopPropagation();
          closeDetails(true);
        }
      }}
    >
      <span className="srOnly">
        {events.length} {events.length === 1 ? "event" : "events"} in this
        range. Select an event to show details.
      </span>
      <ol className="insightEventList">
        {events.map((event, index) => {
          const open = event.key === activeKey;
          const title = event.title || "Scenario event";
          const detailsId = `insight-event-details-${index + 1}`;
          const conciseDate = event.label.replace(/^Expected\s+/i, "");
          return (
            <li key={event.key}>
              <button
                ref={(element) => {
                  if (element) chips.current.set(event.key, element);
                  else chips.current.delete(event.key);
                }}
                type="button"
                className={`insightEventChip${open ? " active" : ""}`}
                aria-label={`${event.label}: ${title}`}
                aria-expanded={open && showDetails}
                aria-controls={open && showDetails ? detailsId : undefined}
                aria-haspopup="dialog"
                title={`${event.label}: ${title}`}
                onClick={(clickEvent) => {
                  if (open) {
                    closeDetails();
                    return;
                  }
                  setAnchor(clickEvent.currentTarget);
                  onActiveChange(event.key);
                }}
              >
                <span className="insightEventNumber" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="insightEventCopy" aria-hidden="true">
                  <span className="insightEventTitle">{title}</span>
                  <span className="insightEventDate">{conciseDate}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Popper
        open={showDetails && !!selected && !!anchor}
        anchorEl={anchor}
        placement="bottom-start"
        disablePortal={disablePortal}
        className="insightEventPopover"
      >
        {selected && (
          <ClickAwayListener
            onClickAway={(event) => {
              if (
                event.target instanceof Node &&
                anchor?.contains(event.target)
              )
                return;
              closeDetails();
            }}
          >
            <Paper elevation={6}>
              <div
                id={`insight-event-details-${events.indexOf(selected) + 1}`}
                key={selected.key}
                className="insightEventDetails"
                tabIndex={-1}
                ref={focusDetails}
                role="dialog"
                aria-label={selected.title || "Scenario event"}
              >
                <Typography variant="subtitle2">
                  {selected.title || "Scenario event"}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {selected.label}
                </Typography>
                <Typography variant="body2">{selected.message}</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    closeDetails(true);
                    onZoom(selected);
                  }}
                >
                  Zoom to event
                </Button>
              </div>
            </Paper>
          </ClickAwayListener>
        )}
      </Popper>
    </section>
  );
}
