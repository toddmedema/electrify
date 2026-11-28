import * as React from "react";
import { Badge, Button, IconButton, Tooltip } from "@mui/material";
import ErrorIcon from "@mui/icons-material/Error";
import HistoryIcon from "@mui/icons-material/History";
import { useAppSelector } from "../../Store";
import { CardNameType } from "../../Types";
import { getScenario } from "../../data/Scenarios";
import { GAME_TOOLS, type GameTool } from "./GameNavigation";
import useDockLabels from "./useDockLabels";
import { useControllerInput } from "../../desktop/InputPresentation";
import { selectTutorialActions } from "../../reducers/Tutorial";

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
    <Tooltip title={label}>
      <IconButton
        className="mapEventStatus"
        color="primary"
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
      >
        <Badge color="primary" variant="dot" invisible={!unreadEvents}>
          {emergency ? <ErrorIcon /> : <HistoryIcon />}
        </Badge>
      </IconButton>
    </Tooltip>
  );
});

/** Map tool actions, with labels that follow the player's input device and tutorial progress. */
export default function Navigation({
  openTools,
  onToggle,
  buildDestination,
  showMapBuild,
  showEventStatus = true,
}: {
  buildDestination?: CardNameType;
  showMapBuild: boolean;
  showEventStatus?: boolean;
  openTools: GameTool[];
  onToggle: (tool: GameTool) => void;
}) {
  const controllerInput = useControllerInput();
  const { unreadEvents, emergency } = useEventStatus(showEventStatus);
  // Tutorials have no term goal or score to show; their own HUD carries the objective
  const hasScenarioDetails = useAppSelector(
    (state) =>
      !getScenario(state.game.scenarioId, state.game.customScenario)
        ?.tutorialSteps,
  );
  const tutorialActions = useAppSelector(selectTutorialActions);
  const { labelId, fromTouch, buttonLabels, dockLabels } = useDockLabels();
  const tutorialDock = !!tutorialActions;
  const tools = GAME_TOOLS.filter(
    (tool) =>
      (hasScenarioDetails || tool.id !== "SCENARIO") &&
      (showMapBuild || tool.id !== "BUILD_GENERATORS") &&
      (!tutorialActions || tutorialActions.includes(tool.id)),
  );
  if (!tools.length) return null;
  return (
    <nav
      id="navfooter"
      className="gameActionDock"
      data-tutorial-dock={tutorialDock || undefined}
      aria-label="Game actions"
      {...dockLabels}
    >
      {tools.map((tool) => {
        const open = openTools.includes(tool.id);
        return (
          <Tooltip
            key={tool.id}
            title={
              fromTouch || controllerInput
                ? tool.label
                : `${tool.label} (${tool.keys.join(", ")})`
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
              aria-keyshortcuts={tool.keys.join(" ")}
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
              data-game-destination={
                tool.id === "BUILD_GENERATORS" ? buildDestination : tool.id
              }
              onClick={() => onToggle(tool.id)}
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
              {tutorialDock && (
                <span className="gameDockTutorialLabel" aria-hidden>
                  {tool.label}
                </span>
              )}
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
