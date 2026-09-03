import * as React from "react";
import { Collapse, Typography } from "@mui/material";
import EventIcon from "@mui/icons-material/Event";
import { UpcomingStoryEventType } from "../views/StoryEventSelectors";

interface Props {
  events: UpcomingStoryEventType[];
  activeKey?: string;
  onActiveChange: (key?: string) => void;
}

export default function InsightEventRail(props: Props): React.JSX.Element {
  const { events, activeKey, onActiveChange } = props;
  const selected = events.find((event) => event.key === activeKey);

  return (
    <section
      className="insightEventRail"
      aria-labelledby="insight-event-rail-title"
    >
      <div className="insightEventRailHeader">
        <EventIcon aria-hidden="true" fontSize="small" />
        <Typography id="insight-event-rail-title" variant="subtitle2">
          Upcoming scenario events
        </Typography>
        <Typography variant="caption" color="textSecondary">
          {events.length} in this range
        </Typography>
      </div>
      <ol className="insightEventList">
        {events.map((event, index) => {
          const open = event.key === activeKey;
          const title = event.title || "Scenario event";
          const detailsId = `insight-event-details-${index + 1}`;
          return (
            <li key={event.key}>
              <button
                type="button"
                className={`insightEventChip${open ? " active" : ""}`}
                aria-label={`${event.label}: ${title}`}
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => onActiveChange(open ? undefined : event.key)}
              >
                <span className="insightEventNumber" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="insightEventChipCopy">
                  <span className="insightEventDate">{event.label}</span>
                  <strong>{title}</strong>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <Collapse in={!!selected} unmountOnExit>
        {selected && (
          <div
            id={`insight-event-details-${events.indexOf(selected) + 1}`}
            className="insightEventDetails"
            role="status"
          >
            <Typography variant="caption" color="textSecondary">
              {selected.label}
            </Typography>
            <Typography variant="body2">
              <strong>{selected.title || "Scenario event"}</strong>
              {" — "}
              {selected.message}
            </Typography>
          </div>
        )}
      </Collapse>
    </section>
  );
}
