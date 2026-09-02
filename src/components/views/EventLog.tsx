import * as React from "react";
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import FilterListIcon from "@mui/icons-material/FilterList";
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

type EventHistoryFilterType =
  "ALL" | "SCENARIO" | "BLACKOUTS" | "PROJECTS" | "MARKET_FINANCE";

const EVENT_HISTORY_FILTERS: {
  value: EventHistoryFilterType;
  label: string;
  emptyMessage?: string;
  kinds?: GameEventKindType[];
}[] = [
  { value: "ALL", label: "All events" },
  {
    value: "SCENARIO",
    label: "Scenario",
    emptyMessage: "No scenario events yet.",
    kinds: ["WORLD_EVENT"],
  },
  {
    value: "BLACKOUTS",
    label: "Blackouts",
    emptyMessage: "No blackout events yet.",
    kinds: ["BLACKOUT", "BLACKOUT_OVER"],
  },
  {
    value: "PROJECTS",
    label: "Projects",
    emptyMessage: "No project events yet.",
    kinds: ["BUILD", "CONSTRUCTION", "SELL"],
  },
  {
    value: "MARKET_FINANCE",
    label: "Market & finance",
    emptyMessage: "No market or finance events yet.",
    kinds: ["FUEL_PRICE", "FUEL_CROSSOVER", "LOAN"],
  },
];

export interface UpcomingStoryEventType {
  key: string;
  label: string;
  title?: string;
  message: string;
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
  const [historyFilter, setHistoryFilter] =
    React.useState<EventHistoryFilterType>("ALL");
  const [filterAnchor, setFilterAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const activeFilter = EVENT_HISTORY_FILTERS.find(
    (filter) => filter.value === historyFilter,
  )!;
  const visibleEvents = activeFilter.kinds
    ? events.filter((event) => activeFilter.kinds?.includes(event.kind))
    : events;
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
            <Tooltip
              title={
                historyFilter === "ALL"
                  ? "Filter event history"
                  : `Filter: ${activeFilter.label}`
              }
            >
              <IconButton
                id="eventHistoryFilterButton"
                className={`eventHistoryFilterButton${historyFilter === "ALL" ? "" : " active"}`}
                size="small"
                onClick={(event) => setFilterAnchor(event.currentTarget)}
                aria-label={`Filter event history, ${activeFilter.label}`}
                aria-controls={
                  filterAnchor ? "eventHistoryFilterMenu" : undefined
                }
                aria-expanded={filterAnchor ? true : undefined}
                aria-haspopup="menu"
              >
                <FilterListIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Menu
              id="eventHistoryFilterMenu"
              anchorEl={filterAnchor}
              open={Boolean(filterAnchor)}
              onClose={() => setFilterAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
              slotProps={{
                list: { "aria-labelledby": "eventHistoryFilterButton" },
              }}
            >
              {EVENT_HISTORY_FILTERS.map((filter) => (
                <MenuItem
                  key={filter.value}
                  role="menuitemradio"
                  aria-checked={historyFilter === filter.value}
                  selected={historyFilter === filter.value}
                  onClick={() => {
                    setHistoryFilter(filter.value);
                    setFilterAnchor(null);
                  }}
                >
                  <ListItemIcon className="eventHistoryFilterCheck">
                    {historyFilter === filter.value && (
                      <CheckIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText>{filter.label}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
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
          {events.length > 0 && visibleEvents.length === 0 && (
            <Typography
              className="eventLogEmpty"
              variant="body2"
              color="textSecondary"
            >
              {activeFilter.emptyMessage}
            </Typography>
          )}
          <ul className="eventLogList">
            {visibleEvents.map((event: GameEventType) => (
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
