import * as React from "react";
import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { useWorkspaceLayout } from "../../WorkspaceLayout";
import { BuildForecastProvider } from "./BuildForecast";
import GameAppBar from "./GameAppBar";
import Navigation, {
  GAME_TOOLS,
  MAP_VIEWS,
  gameToolForCard,
  GameTool,
} from "./Navigation";
import {
  GameToolMemoryContext,
  useToolFocusMemory,
  useToolScroll,
} from "./GameToolMemory";
import {
  GameWorkspaceContext,
  GameWorkspaceLayoutContext,
  GameToolCloseContext,
  MapWorkspacePanelContext,
} from "./GameWorkspaceContext";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";
import Facilities from "../views/FacilitiesContainer";
import Programs from "../views/Programs";
import Insights from "../views/InsightsContainer";
import EventLog from "../views/EventLogContainer";
import ScenarioDetails from "./ScenarioDetails";

type MapTool = Exclude<GameTool, "BUILD_GENERATORS"> | "FLEET" | "AGREEMENTS";

/** A stable map canvas with a single, replaceable right-hand decision surface. */
export default function MapWorkspace({
  memory: sharedMemory,
}: {
  memory?: Map<string, unknown>;
}) {
  const dispatch = useAppDispatch();
  const card = useAppSelector((state) => state.card.name);
  const settings = useAppSelector((state) => state.settings);
  const candidate = gameToolForCard(card);
  const active: MapTool | undefined =
    card === "FLEET" || card === "AGREEMENTS"
      ? card
      : candidate === "BUILD_GENERATORS"
        ? undefined
        : candidate;
  const localMemory = React.useRef(new Map<string, unknown>());
  const memory = sharedMemory ?? localMemory.current;
  const workspace = React.useRef<HTMLDivElement>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const [programBack, setProgramBack] = React.useState<() => void>();
  const presentation = useWorkspaceLayout(workspace, settings);
  const { effectiveWidth } = presentation;
  useToolFocusMemory(workspace, memory, active ?? "fleet", "map");
  const config =
    active && [...MAP_VIEWS, ...GAME_TOOLS].find((item) => item.id === active);
  const returnToMap = React.useCallback(
    () => dispatch(navigate("FACILITIES")),
    [dispatch],
  );
  const close = React.useCallback(() => {
    returnToMap();
    if (config)
      document.getElementById(config.triggerId)?.focus({ preventScroll: true });
  }, [config, returnToMap]);
  React.useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [active]);
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !active ||
        hasVisibleEscapeOverlay()
      )
        return;
      if (
        active === "PROGRAMS" &&
        document.querySelector('[data-program-decision="true"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active, close]);
  const panel = React.useMemo(
    () => ({ open: !!active, inspect: returnToMap }),
    [active, returnToMap],
  );
  return (
    <GameToolMemoryContext.Provider value={memory}>
      <GameWorkspaceContext.Provider value={true}>
        <GameWorkspaceLayoutContext.Provider
          value={{
            ...presentation,
            capacity: 1,
            fleetVisible: active === "FLEET",
          }}
        >
          <MapWorkspacePanelContext.Provider value={panel}>
            <BuildForecastProvider>
              <div
                className="gameWorkspace"
                data-map-workspace="true"
                data-persistent-map="true"
                data-workspace-layout="map"
                data-compact-dock={effectiveWidth < 700}
                data-dock-size={
                  effectiveWidth >= 2200
                    ? "large"
                    : effectiveWidth >= 1600
                      ? "medium"
                      : "normal"
                }
                ref={workspace}
                style={{
                  ["--game-tool-width" as string]: `${presentation.toolWidth}px`,
                }}
              >
                <GameAppBar />
                <div
                  className="gameStage"
                  data-layout="map"
                  data-panel-count={Number(!!active)}
                >
                  <div className="gameFleet gameMapStage" data-chart-viewport>
                    <Facilities
                      paneId="mapPane"
                      territoryView="FACILITIES"
                      onTerritoryView={(view) => dispatch(navigate(view))}
                    />
                  </div>
                  <div className="gameToolTray">
                    {active && config && (
                      <section
                        key={active}
                        id={`tool-${active}`}
                        className="gameToolPanel"
                        aria-label={config.label}
                        data-game-tool={active}
                        data-tool-side="right"
                      >
                        <header className="gameToolHeader">
                          {active === "PROGRAMS" && programBack && (
                            <IconButton
                              color="primary"
                              aria-label="Back to programs"
                              onClick={programBack}
                            >
                              <ChevronLeftIcon />
                            </IconButton>
                          )}
                          <h2
                            className="gameToolTitle"
                            tabIndex={-1}
                            ref={heading}
                          >
                            <span className="gameToolTitleIcon">
                              {config.icon}
                            </span>
                            {config.label}
                          </h2>
                          <IconButton
                            aria-label={`Close ${config.label}`}
                            onClick={close}
                          >
                            <CloseIcon />
                          </IconButton>
                        </header>
                        <MapToolBody tool={active}>
                          <GameToolCloseContext.Provider value={close}>
                            {(active === "FLEET" ||
                              active === "AGREEMENTS") && (
                              <Facilities territoryView={active} />
                            )}
                            {active === "PROGRAMS" && (
                              <Programs
                                onClose={close}
                                onBackChange={setProgramBack}
                              />
                            )}
                            {active === "INSIGHTS" && <Insights />}
                            {active === "EVENTS" && <EventLog />}
                            {active === "SCENARIO" && <ScenarioDetails />}
                          </GameToolCloseContext.Provider>
                        </MapToolBody>
                      </section>
                    )}
                  </div>
                </div>
                <Navigation
                  mapView={
                    active === "FLEET" || active === "AGREEMENTS"
                      ? active
                      : "FACILITIES"
                  }
                  onMapView={(view) => dispatch(navigate(view))}
                  openTools={
                    active && active !== "FLEET" && active !== "AGREEMENTS"
                      ? [active]
                      : []
                  }
                  onToggle={(tool) =>
                    dispatch(navigate(active === tool ? "FACILITIES" : tool))
                  }
                />
              </div>
            </BuildForecastProvider>
          </MapWorkspacePanelContext.Provider>
        </GameWorkspaceLayoutContext.Provider>
      </GameWorkspaceContext.Provider>
    </GameToolMemoryContext.Provider>
  );
}

function MapToolBody({
  tool,
  children,
}: {
  tool: MapTool;
  children: React.ReactNode;
}) {
  const ref = useToolScroll<HTMLDivElement>(`workspace.${tool}.scroll`);
  return (
    <div className="gameToolBody" data-chart-viewport ref={ref}>
      {children}
    </div>
  );
}
