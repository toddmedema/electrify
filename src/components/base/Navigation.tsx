import * as React from "react";
import { Badge, Button, Tooltip } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import InsertChartIcon from "@mui/icons-material/InsertChart";
import FactoryIcon from "@mui/icons-material/Factory";
import HandshakeIcon from "@mui/icons-material/Handshake";
import ErrorIcon from "@mui/icons-material/Error";
import { useAppSelector, useAppDispatch } from "../../Store";
import {
  CardNameType,
  CardType,
  GameToolType,
  MapWorkspaceView,
} from "../../Types";
import { navigate, selectCardName } from "../../reducers/Card";
import { getScenario } from "../../data/Scenarios";
import ConceptIcon from "./ConceptIcon";
import useDockLabels from "./useDockLabels";
import { TOOL_SHORTCUTS } from "./KeyboardShortcuts";
import { useControllerInput } from "../../desktop/InputPresentation";
import { hasTerritoryNetwork } from "../../helpers/Territories";
import { selectTutorialActions } from "../../reducers/Tutorial";

export interface StateProps {
  card: CardType;
}
export interface Props extends StateProps {}
export type GameTool = GameToolType;
export type MapPanelView = Exclude<MapWorkspaceView, "FACILITIES">;
export const GAME_TOOLS: {
  id: GameTool;
  label: string;
  triggerId: string;
  icon: React.ReactElement;
}[] = [
  {
    id: "BUILD_GENERATORS",
    label: "Build",
    triggerId: "buildNav",
    icon: <ConceptIcon concept="build" />,
  },
  {
    id: "PROGRAMS",
    label: "Programs",
    triggerId: "programsNav",
    icon: <ConceptIcon concept="customers" />,
  },
  {
    id: "INSIGHTS",
    label: "Insights",
    triggerId: "insightsNav",
    icon: <InsertChartIcon />,
  },
  {
    id: "EVENTS",
    label: "Events",
    triggerId: "eventsNav",
    icon: <HistoryIcon />,
  },
  {
    id: "SCENARIO",
    label: "Scenario",
    triggerId: "scenarioNav",
    icon: <ConceptIcon concept="goal" />,
  },
];
export const MAP_VIEWS: {
  id: MapPanelView;
  label: string;
  triggerId: string;
  icon: React.ReactElement;
}[] = [
  { id: "FLEET", label: "Fleet", triggerId: "fleetNav", icon: <FactoryIcon /> },
  {
    id: "AGREEMENTS",
    label: "Agreements",
    triggerId: "agreementsNav",
    icon: <HandshakeIcon />,
  },
];

export function gameToolForCard(card: CardNameType): GameTool | undefined {
  return card.startsWith("BUILD_")
    ? "BUILD_GENERATORS"
    : GAME_TOOLS.find((tool) => tool.id === card)?.id;
}

function useEventStatus(enabled = true) {
  const unreadEvents = useAppSelector(
    (state) =>
      enabled &&
      (state.game.eventLog[0]?.id || 0) > state.game.eventLogReadThroughId,
  );
  const emergency = useAppSelector(
    (state) =>
      enabled &&
      state.game.worldEvents.active.some(
        (event) =>
          event.importance === "CRITICAL" &&
          event.startsMinute <= state.game.date.minute &&
          event.endsMinute > state.game.date.minute,
      ),
  );
  return { unreadEvents, emergency };
}

export const MapEventStatus = React.memo(function MapEventStatus({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: (tool: "EVENTS") => void;
}) {
  const tutorialActions = useAppSelector(selectTutorialActions);
  const { unreadEvents, emergency } = useEventStatus(
    !tutorialActions || tutorialActions.includes("EVENTS"),
  );
  const [focused, setFocused] = React.useState(false);
  // An emergency can end on a tick. Keep the focused control usable until the
  // player tabs away or opens Events.
  if (!emergency && !unreadEvents && !focused) return null;

  const label = emergency
    ? "Emergency"
    : unreadEvents
      ? "Unread events"
      : "Event history";
  return (
    <Button
      className="mapEventStatus"
      data-emergency={emergency}
      aria-label={
        emergency
          ? unreadEvents
            ? "Ongoing emergency, unread events"
            : "Ongoing emergency"
          : label
      }
      aria-expanded={open}
      aria-controls={open ? "tool-EVENTS" : undefined}
      onClick={() => onToggle("EVENTS")}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      startIcon={emergency ? <ErrorIcon /> : <HistoryIcon />}
    >
      {label}
    </Button>
  );
});

/** Expose the same accessible tool actions in card navigation and the pane workspace.
 * Couch docks can hide visible labels without changing names, tutorial restrictions or callbacks. */
export default function Navigation({
  openTools,
  onToggle,
  destination,
  openMapViews = [],
  onToggleMapView,
  showMapBuild = false,
  showEventStatus = true,
}: {
  openMapViews?: MapPanelView[];
  onToggleMapView?: (view: MapPanelView) => void;
  showMapBuild?: boolean;
  showEventStatus?: boolean;
  openTools?: GameTool[];
  onToggle?: (tool: GameTool) => void;
  destination?: (tool: GameTool) => CardNameType;
}) {
  const dispatch = useAppDispatch();
  const controllerInput = useControllerInput();
  const cardName = useAppSelector(selectCardName);
  const { unreadEvents, emergency } = useEventStatus(showEventStatus);
  // Tutorials have no term goal or score to show; their own HUD carries the objective
  const hasScenarioDetails = useAppSelector(
    (state) =>
      !getScenario(state.game.scenarioId, state.game.customScenario)
        ?.tutorialSteps,
  );
  const opened = openTools ?? [gameToolForCard(cardName)];
  const tutorialActions = useAppSelector(selectTutorialActions);
  const { labelId, fromTouch, buttonLabels, dockLabels } = useDockLabels();
  const mapWorkspace = useAppSelector((state) =>
    hasTerritoryNetwork(state.game),
  );
  const tools = GAME_TOOLS.filter(
    (tool) =>
      (hasScenarioDetails || tool.id !== "SCENARIO") &&
      (!mapWorkspace || showMapBuild || tool.id !== "BUILD_GENERATORS") &&
      (!tutorialActions || tutorialActions.includes(tool.id)),
  );
  if (!tools.length) return null;
  return (
    <nav
      id="navfooter"
      className="gameActionDock"
      aria-label="Game actions"
      {...dockLabels}
    >
      {mapWorkspace &&
        MAP_VIEWS.map((view) => {
          const open = openMapViews.includes(view.id);
          return (
            <Tooltip
              key={view.id}
              title={view.label}
              placement="top"
              open={labelId === view.triggerId}
              disableHoverListener
              disableFocusListener
              disableTouchListener
              disableInteractive
            >
              <Button
                id={view.triggerId}
                {...buttonLabels}
                className={`gameDockAction${open ? " gameDockActionOpen" : ""}`}
                aria-label={view.label}
                aria-expanded={open}
                aria-controls={open ? `tool-${view.id}` : undefined}
                data-game-destination={view.id}
                onClick={() =>
                  onToggleMapView
                    ? onToggleMapView(view.id)
                    : dispatch(navigate(open ? "FACILITIES" : view.id))
                }
              >
                <Badge>{view.icon}</Badge>
              </Button>
            </Tooltip>
          );
        })}
      {tools.map((tool) => {
        const open = opened.includes(tool.id);
        return (
          <Tooltip
            key={tool.id}
            title={
              fromTouch || controllerInput
                ? tool.label
                : `${tool.label} (${TOOL_SHORTCUTS[tool.id].join(", ")})`
            }
            placement="top"
            open={labelId === tool.triggerId}
            disableHoverListener
            disableFocusListener
            disableTouchListener
            disableInteractive
          >
            <Button
              id={tool.triggerId}
              {...buttonLabels}
              className={`gameDockAction ${tool.id === "BUILD_GENERATORS" ? "button-buildFacility gameDockBuild" : ""}${open ? " gameDockActionOpen" : ""}`}
              aria-expanded={open}
              aria-label={tool.label}
              aria-keyshortcuts={TOOL_SHORTCUTS[tool.id].join(" ")}
              aria-describedby={
                tool.id === "EVENTS"
                  ? [
                      emergency && "eventsEmergency",
                      unreadEvents && "eventsUnread",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  : undefined
              }
              aria-controls={open ? `tool-${tool.id}` : undefined}
              data-game-destination={destination?.(tool.id)}
              onClick={() =>
                onToggle
                  ? onToggle(tool.id)
                  : dispatch(navigate(open ? "FACILITIES" : tool.id))
              }
            >
              <Badge
                key={tool.id === "EVENTS" && emergency ? "emergency" : "unread"}
                className={
                  tool.id === "EVENTS" && emergency
                    ? "gameDockEmergency"
                    : undefined
                }
                color="primary"
                variant={tool.id === "EVENTS" && emergency ? "standard" : "dot"}
                badgeContent={
                  tool.id === "EVENTS" && emergency ? <ErrorIcon /> : undefined
                }
                invisible={
                  tool.id !== "EVENTS" || (!unreadEvents && !emergency)
                }
              >
                {tool.icon}
              </Badge>
              {tool.id === "EVENTS" && emergency && (
                <span className="srOnly" id="eventsEmergency">
                  Ongoing emergency
                </span>
              )}
              {tool.id === "EVENTS" && unreadEvents && (
                <span className="srOnly" id="eventsUnread">
                  Unread events
                </span>
              )}
            </Button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
