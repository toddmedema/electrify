import * as React from "react";
import HistoryIcon from "@mui/icons-material/History";
import InsertChartIcon from "@mui/icons-material/InsertChart";
import FactoryIcon from "@mui/icons-material/Factory";
import HandshakeIcon from "@mui/icons-material/Handshake";
import type { GameToolType, MapWorkspaceView } from "../../Types";
import ConceptIcon from "./ConceptIcon";

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
    label: "Trade",
    triggerId: "agreementsNav",
    icon: <HandshakeIcon />,
  },
];

export function GameNavigationLabel({
  destination,
  children,
}: {
  destination: GameTool | MapPanelView;
  children: React.ReactNode;
}): React.JSX.Element {
  const item = [...GAME_TOOLS, ...MAP_VIEWS].find(
    ({ id }) => id === destination,
  )!;
  return (
    <strong className="gameNavigationLabel">
      <span aria-hidden="true">{item.icon}</span>
      {children}
    </strong>
  );
}
