import * as React from "react";
import { Typography } from "@mui/material";
import GameCard from "../base/GameCard";
import { GameEventKindType, GameEventType } from "../../Types";
import ConceptIcon, { ConceptNameType } from "../base/ConceptIcon";

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
};

export interface StateProps {
  events: GameEventType[];
}

export interface DispatchProps {
  onOpen: () => void;
  onSelect: (event: GameEventType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function EventLog(props: Props): React.JSX.Element {
  const { events, onOpen, onSelect } = props;
  React.useEffect(() => onOpen(), [onOpen]);
  return (
    <GameCard className="eventLog" title="Events" id="eventsPane">
      <div className="scrollable">
        {events.length === 0 && (
          <Typography
            className="eventLogEmpty"
            variant="body2"
            color="textSecondary"
          >
            Blackouts, finished construction, loans closing and fuel price
            swings will show up here as they happen.
          </Typography>
        )}
        <ul className="eventLogList">
          {events.map((event: GameEventType) => (
            <li
              className={`eventLogItem kind-${event.kind} importance-${event.importance || "ROUTINE"}${event.actionTarget ? " actionable" : ""}`}
              key={event.id}
              onClick={() => onSelect(event)}
              onKeyDown={(e: React.KeyboardEvent<HTMLLIElement>) => {
                if (
                  event.actionTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  onSelect(event);
                }
              }}
              role={event.actionTarget ? "button" : undefined}
              tabIndex={event.actionTarget ? 0 : undefined}
            >
              <span className="eventLogIcon">
                <ConceptIcon
                  concept={KIND_CONCEPTS[event.kind]}
                  fontSize="small"
                />
              </span>
              <Typography variant="body2" component="span">
                {event.message}
              </Typography>
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
      </div>
    </GameCard>
  );
}
