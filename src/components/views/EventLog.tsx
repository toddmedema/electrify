import * as React from "react";
import { Typography } from "@mui/material";
import GameCard from "../base/GameCard";
import {
  ConceptNameType,
  GameEventImportanceType,
  GameEventKindType,
  GameEventType,
  StoryActionTargetType,
} from "../../Types";
import ConceptIcon from "../base/ConceptIcon";

/**
 * What has happened to the company, in the order it happened.
 *
 * Everything in here used to be told to the player exactly once and then thrown away: a blackout
 * was a toolbar that pulsed until it stopped, a finished plant a toast that lasted four seconds.
 * Look away, or look at another pane, and there was no way to find out what you had missed --
 * which makes a simulation feel arbitrary rather than causal. This is the run's own record of it.
 */

const KIND_CONCEPTS: { [k in GameEventKindType]: ConceptNameType } = {
  BLACKOUT: "blackout",
  BLACKOUT_OVER: "supply",
  CONSTRUCTION: "construction",
  BUILD: "build",
  SELL: "money",
  LOAN: "finances",
  FUEL_PRICE: "fuel",
  FUEL_CROSSOVER: "fuel",
  WORLD_EVENT: "forecast",
};

export interface UpcomingStoryEventType {
  key: string;
  label: string;
  title?: string;
  message: string;
  details?: string;
  concept?: ConceptNameType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
}

export interface StateProps {
  events: GameEventType[];
  upcoming?: UpcomingStoryEventType[];
}

export interface DispatchProps {
  onOpen: () => void;
  onSelect: (target?: StoryActionTargetType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function EventLog(props: Props): React.JSX.Element {
  const { events, onOpen, onSelect, upcoming = [] } = props;
  // An effect may only return a cleanup function. Redux dispatch returns the dispatched action,
  // so the expression-bodied form returned an object here; React later tried to call that object
  // while unmounting this phone-only pane and crashed the app to a blank screen.
  React.useEffect(() => {
    onOpen();
  }, [onOpen]);
  return (
    <GameCard className="eventLog" title="Events" id="eventsPane">
      <div className="scrollable">
        {upcoming.length > 0 && (
          <section
            className="eventLogSection upcomingEvents"
            aria-labelledby="upcomingEventsTitle"
          >
            <header className="eventLogSectionHeader">
              <Typography id="upcomingEventsTitle" variant="subtitle2">
                Upcoming events
              </Typography>
            </header>
            <ul className="eventLogList">
              {upcoming.map((event) => (
                <li
                  className={`eventLogItem upcoming importance-${event.importance || "ROUTINE"}${event.actionTarget ? " actionable" : ""}`}
                  key={event.key}
                  onClick={() => onSelect(event.actionTarget)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLLIElement>) => {
                    if (
                      event.actionTarget &&
                      (e.key === "Enter" || e.key === " ")
                    ) {
                      e.preventDefault();
                      onSelect(event.actionTarget);
                    }
                  }}
                  role={event.actionTarget ? "button" : undefined}
                  tabIndex={event.actionTarget ? 0 : undefined}
                >
                  <span className="eventLogIcon">
                    <ConceptIcon
                      concept={event.concept || "forecast"}
                      fontSize="small"
                    />
                  </span>
                  <span>
                    {event.title && <strong>{event.title}</strong>}
                    <span className="eventLogCopy">
                      <Typography
                        variant="body2"
                        component="span"
                        sx={{ display: "block" }}
                      >
                        {event.message}
                      </Typography>
                      {event.details && (
                        <Typography
                          variant="caption"
                          color="textSecondary"
                          component="span"
                          sx={{ display: "block" }}
                        >
                          {event.details}
                        </Typography>
                      )}
                    </span>
                  </span>
                  <Typography
                    className="eventLogWhen"
                    variant="body2"
                    color="textSecondary"
                    component="span"
                  >
                    {event.label}
                  </Typography>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section
          className="eventLogSection eventHistory"
          aria-labelledby="eventHistoryTitle"
        >
          <header className="eventLogSectionHeader">
            <Typography id="eventHistoryTitle" variant="subtitle2">
              Event history
            </Typography>
          </header>
          {events.length === 0 && (
            <Typography
              className="eventLogEmpty"
              variant="body2"
              color="textSecondary"
            >
              Blackouts, completed builds, loans, and fuel-price changes appear
              here.
            </Typography>
          )}
          <ul className="eventLogList">
            {events.map((event: GameEventType) => (
              <li
                className={`eventLogItem kind-${event.kind} importance-${event.importance || "ROUTINE"}${event.actionTarget ? " actionable" : ""}`}
                key={event.id}
                onClick={() => onSelect(event.actionTarget)}
                onKeyDown={(e: React.KeyboardEvent<HTMLLIElement>) => {
                  if (
                    event.actionTarget &&
                    (e.key === "Enter" || e.key === " ")
                  ) {
                    e.preventDefault();
                    onSelect(event.actionTarget);
                  }
                }}
                role={event.actionTarget ? "button" : undefined}
                tabIndex={event.actionTarget ? 0 : undefined}
              >
                <span className="eventLogIcon">
                  <ConceptIcon
                    concept={event.concept || KIND_CONCEPTS[event.kind]}
                    fontSize="small"
                  />
                </span>
                <span>
                  {event.title && <strong>{event.title}</strong>}
                  <span className="eventLogCopy">
                    <Typography
                      variant="body2"
                      component="span"
                      sx={{ display: "block" }}
                    >
                      {event.message}
                    </Typography>
                    {event.details && (
                      <Typography
                        variant="caption"
                        color="textSecondary"
                        component="span"
                        sx={{ display: "block" }}
                      >
                        {event.details}
                      </Typography>
                    )}
                  </span>
                </span>
                <Typography
                  className="eventLogWhen"
                  variant="body2"
                  color="textSecondary"
                  component="span"
                >
                  {event.label}
                </Typography>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </GameCard>
  );
}
