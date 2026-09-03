import * as React from "react";
import { ClickAwayListener, Paper, Popper, Typography } from "@mui/material";
import { UpcomingStoryEventType } from "../views/StoryEventSelectors";

interface Props {
  events: UpcomingStoryEventType[];
  activeKey?: string;
  onActiveChange: (key?: string) => void;
}

export default function InsightEventRail(props: Props): React.JSX.Element {
  const { events, activeKey, onActiveChange } = props;
  const selected = events.find((event) => event.key === activeKey);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  const closeDetails = () => {
    setAnchor(null);
    onActiveChange(undefined);
  };

  return (
    <section
      className="insightEventRail"
      aria-label="Upcoming scenario events"
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Escape" && selected) {
          keyEvent.preventDefault();
          closeDetails();
        }
      }}
    >
      <span className="insightEventRailLabel" aria-hidden="true">
        Upcoming
      </span>
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
                type="button"
                className={`insightEventChip${open ? " active" : ""}`}
                aria-label={`${event.label}: ${title}`}
                aria-expanded={open}
                aria-controls={open ? detailsId : undefined}
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
                <span className="insightEventDate" aria-hidden="true">
                  {conciseDate}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Popper
        open={!!selected && !!anchor}
        anchorEl={anchor}
        placement="bottom-start"
        className="insightEventPopover"
      >
        {selected && (
          <ClickAwayListener onClickAway={closeDetails}>
            <Paper elevation={6}>
              <div
                id={`insight-event-details-${events.indexOf(selected) + 1}`}
                className="insightEventDetails"
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
              </div>
            </Paper>
          </ClickAwayListener>
        )}
      </Popper>
    </section>
  );
}
