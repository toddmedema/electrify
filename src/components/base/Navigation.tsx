import * as React from "react";
import { Badge, Button, Tooltip } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import InsertChartIcon from "@mui/icons-material/InsertChart";
import GroupsIcon from "@mui/icons-material/Groups";
import { useAppSelector, useAppDispatch } from "../../Store";
import { CardNameType, CardType, GameToolType } from "../../Types";
import { navigate, selectCardName } from "../../reducers/Card";
import { getScenario } from "../../data/Scenarios";
import ConceptIcon from "./ConceptIcon";
import useDockLabels from "./useDockLabels";
import { TOOL_SHORTCUTS } from "./KeyboardShortcuts";
import { selectTutorialActions } from "../../reducers/Tutorial";

export interface StateProps {
  card: CardType;
}
export interface Props extends StateProps {}
export type GameTool = GameToolType;
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
    icon: <GroupsIcon />,
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
export function gameToolForCard(card: CardNameType): GameTool | undefined {
  return card.startsWith("BUILD_")
    ? "BUILD_GENERATORS"
    : GAME_TOOLS.find((tool) => tool.id === card)?.id;
}

export default function Navigation({
  openTools,
  onToggle,
}: {
  openTools?: GameTool[];
  onToggle?: (tool: GameTool) => void;
}) {
  const dispatch = useAppDispatch();
  const cardName = useAppSelector(selectCardName);
  const readOnly = useAppSelector((state) => !!state.game.replayPlayback);
  const unreadEvents = useAppSelector(
    (state) =>
      (state.game.eventLog[0]?.id || 0) > state.game.eventLogReadThroughId,
  );
  // Tutorials have no term goal or score to show; their own HUD carries the objective
  const hasScenarioDetails = useAppSelector(
    (state) =>
      !getScenario(state.game.scenarioId, state.game.customScenario)
        ?.tutorialSteps,
  );
  const opened = openTools ?? [gameToolForCard(cardName)];
  const tutorialActions = useAppSelector(selectTutorialActions);
  const { labelId, fromTouch, buttonLabels, dockLabels } = useDockLabels();
  const tools = GAME_TOOLS.filter(
    (tool) =>
      (!readOnly || tool.id !== "BUILD_GENERATORS") &&
      (hasScenarioDetails || tool.id !== "SCENARIO") &&
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
      {tools.map((tool) => {
        const open = opened.includes(tool.id);
        return (
          <Tooltip
            key={tool.id}
            title={
              fromTouch
                ? tool.label
                : `${tool.label} (${TOOL_SHORTCUTS[tool.id]})`
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
              aria-keyshortcuts={TOOL_SHORTCUTS[tool.id]}
              aria-describedby={
                tool.id === "EVENTS" && unreadEvents
                  ? "eventsUnread"
                  : undefined
              }
              aria-controls={open ? `tool-${tool.id}` : undefined}
              onClick={() =>
                onToggle
                  ? onToggle(tool.id)
                  : dispatch(navigate(open ? "FACILITIES" : tool.id))
              }
            >
              <Badge
                color="primary"
                variant="dot"
                invisible={tool.id !== "EVENTS" || !unreadEvents}
              >
                {tool.icon}
              </Badge>
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
