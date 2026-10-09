import * as React from "react";
import {
  Button,
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
  GameEventKindType,
  GameEventType,
  StoryActionTargetType,
} from "../../Types";
import ConceptIcon from "../base/ConceptIcon";
import { UpcomingStoryEventType } from "./StoryEventSelectors";
import { WildfireRiskNoticeType } from "../../helpers/Wildfire";
import { getStorageJson, setStorageKeyValue } from "../../LocalStorage";
import "../base/ProgressFeedback.scss";

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

// History keeps the simulation's exact consequence; these labels make its transition scannable.
const CHANGE_LABELS: Partial<Record<GameEventKindType, string>> = {
  BLACKOUT: "Power shortage",
  BLACKOUT_OVER: "Power restored",
  CONSTRUCTION: "Project complete",
  BUILD: "Project started",
  SELL: "Facility sold",
};

type EventHistoryFilterType =
  "WORLD" | "BLACKOUTS" | "PROJECTS" | "MARKET_FINANCE";

const EVENT_HISTORY_FILTERS: {
  value: EventHistoryFilterType;
  label: string;
  emptyMessage?: string;
  kinds: GameEventKindType[];
}[] = [
  {
    // Scenario stories, wildfires and weather hazards all log as world events
    value: "WORLD",
    label: "World events",
    emptyMessage: "No world or weather events yet.",
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

export interface StateProps {
  evidenceRequest?: import("../../Types").EvidenceRequestType;
  facilityDragActive?: boolean;
  events: GameEventType[];
  upcoming?: UpcomingStoryEventType[];
  ongoing?: UpcomingStoryEventType[];
  riskNotice?: WildfireRiskNoticeType;
}

export interface DispatchProps {
  onEvidenceReady?: (
    request: import("../../Types").EvidenceRequestType,
    element: HTMLElement | null,
  ) => void;
  onOpen: () => void;
  onSelect: (target?: StoryActionTargetType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function EventLog(props: Props): React.JSX.Element {
  const { evidenceRequest, facilityDragActive, onEvidenceReady } = props;
  const openedForEvidence = React.useRef(!!evidenceRequest);
  const evidenceAnchor = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const request = evidenceRequest;
    if (
      request &&
      typeof request.target === "object" &&
      request.target.card === "EVENTS" &&
      !facilityDragActive
    ) {
      onEvidenceReady?.(request, evidenceAnchor.current);
    }
  }, [evidenceRequest, facilityDragActive, onEvidenceReady]);
  const {
    events,
    onOpen,
    onSelect,
    upcoming = [],
    ongoing = [],
    riskNotice,
  } = props;
  const [historyFilters, setHistoryFilters] = React.useState<
    EventHistoryFilterType[]
  >(() => {
    const all = EVENT_HISTORY_FILTERS.map((filter) => filter.value);
    const saved = getStorageJson<unknown[]>("eventHistoryFilters", all);
    return Array.isArray(saved)
      ? all.filter((value) => saved.includes(value))
      : all;
  });
  React.useEffect(() => {
    setStorageKeyValue("eventHistoryFilters", historyFilters);
  }, [historyFilters]);
  const [filterAnchor, setFilterAnchor] = React.useState<HTMLElement | null>(
    null,
  );
  const activeFilters = EVENT_HISTORY_FILTERS.filter((filter) =>
    historyFilters.includes(filter.value),
  );
  const allSelected = activeFilters.length === EVENT_HISTORY_FILTERS.length;
  const filterLabel = allSelected
    ? "All events"
    : activeFilters.length
      ? activeFilters.map((filter) => filter.label).join(", ")
      : "No event types selected";
  const visibleEvents = events.filter((event) =>
    activeFilters.some((filter) => filter.kinds.includes(event.kind)),
  );
  // An effect may only return a cleanup function. Redux dispatch returns the dispatched action,
  // so the expression-bodied form returned an object here; React later tried to call that object
  // while unmounting this phone-only pane and crashed the app to a blank screen.
  React.useEffect(() => {
    // A semantic evidence request changes presentation only. Ordinary visits retain the
    // existing mark-read action; resolving or acknowledging a request must not dispatch it.
    if (!openedForEvidence.current) onOpen();
  }, [onOpen]);
  return (
    <GameCard className="eventLog" title="Events" id="eventsPane">
      <div
        className="scrollable"
        ref={evidenceAnchor}
        tabIndex={-1}
        aria-label="Announced events and event history evidence"
      >
        {riskNotice && (
          <section
            className="eventLogSection wildfireRiskNotice"
            aria-labelledby="wildfireRiskNoticeTitle"
          >
            <header className="eventLogSectionHeader">
              <Typography id="wildfireRiskNoticeTitle" variant="subtitle2">
                {riskNotice.title}
              </Typography>
            </header>
            <Typography variant="body2" color="textSecondary">
              {riskNotice.message}
            </Typography>
          </section>
        )}
        {ongoing.length > 0 && (
          <section
            className="eventLogSection ongoingEvents"
            aria-labelledby="ongoingEventsTitle"
          >
            <header className="eventLogSectionHeader">
              <Typography id="ongoingEventsTitle" variant="subtitle2">
                Ongoing events
              </Typography>
            </header>
            <ul className="eventLogList">
              {ongoing.map((event) => (
                <li
                  className={`eventLogItem ongoing importance-${event.importance || "ROUTINE"}${event.actionTarget ? " actionable" : ""}`}
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
                allSelected ? "Filter event history" : `Filter: ${filterLabel}`
              }
            >
              <Button
                id="eventHistoryFilterButton"
                className={`eventHistoryFilterButton${allSelected ? "" : " active"}`}
                size="small"
                onClick={(event) => setFilterAnchor(event.currentTarget)}
                aria-label={`Filter event history, ${filterLabel}`}
                startIcon={<FilterListIcon fontSize="small" />}
                aria-controls={
                  filterAnchor ? "eventHistoryFilterMenu" : undefined
                }
                aria-expanded={filterAnchor ? true : undefined}
                aria-haspopup="menu"
              >
                {allSelected
                  ? "Filter"
                  : `Types ${activeFilters.length}/${EVENT_HISTORY_FILTERS.length}`}
              </Button>
            </Tooltip>
            <Menu
              id="eventHistoryFilterMenu"
              anchorEl={filterAnchor}
              open={Boolean(filterAnchor)}
              onClose={() => setFilterAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
              slotProps={{
                list: {
                  "aria-labelledby": "eventHistoryFilterButton",
                  sx: {
                    "& .MuiMenuItem-root": {
                      minHeight: 40,
                      "@media (pointer: coarse)": { minHeight: 44 },
                    },
                  },
                },
              }}
            >
              <MenuItem
                onClick={() =>
                  setHistoryFilters(
                    EVENT_HISTORY_FILTERS.map((filter) => filter.value),
                  )
                }
              >
                Show all events
              </MenuItem>
              {EVENT_HISTORY_FILTERS.map((filter) => (
                <MenuItem
                  key={filter.value}
                  role="menuitemcheckbox"
                  aria-checked={historyFilters.includes(filter.value)}
                  selected={historyFilters.includes(filter.value)}
                  onClick={() => {
                    setHistoryFilters((selected) =>
                      selected.includes(filter.value)
                        ? selected.filter((value) => value !== filter.value)
                        : [...selected, filter.value],
                    );
                  }}
                >
                  <ListItemIcon className="eventHistoryFilterCheck">
                    {historyFilters.includes(filter.value) && (
                      <CheckIcon fontSize="small" />
                    )}
                  </ListItemIcon>
                  <ListItemText>{filter.label}</ListItemText>
                </MenuItem>
              ))}
              <MenuItem onClick={() => setFilterAnchor(null)}>Done</MenuItem>
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
              {activeFilters.length === 0
                ? "Select an event type to show its history."
                : activeFilters.length === 1
                  ? activeFilters[0].emptyMessage
                  : "No events match the selected types yet."}
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
                  {(event.title || CHANGE_LABELS[event.kind]) && (
                    <strong className="eventChangeTitle">
                      {event.title || CHANGE_LABELS[event.kind]}
                    </strong>
                  )}
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
