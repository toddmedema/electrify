import * as React from "react";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { useControllerInput } from "../../desktop/InputPresentation";
import { SIDE_TOOL_MIN_WIDTH, useWorkspaceLayout } from "../../WorkspaceLayout";
import { BuildForecastProvider } from "./BuildForecast";
import GameAppBar from "./GameAppBar";
import Navigation, {
  GAME_TOOLS,
  MAP_VIEWS,
  gameToolForCard,
  GameTool,
  MapEventStatus,
  MapPanelView,
} from "./Navigation";
import { GameToolMemoryContext, useToolFocusMemory } from "./GameToolMemory";
import MapPanelWindow, { useMapWindowArea } from "./MapPanelWindow";
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

type MapTool = Exclude<GameTool, "BUILD_GENERATORS"> | MapPanelView;
const MAP_TOOLS = [...MAP_VIEWS, ...GAME_TOOLS].filter(
  (tool): tool is typeof tool & { id: MapTool } =>
    tool.id !== "BUILD_GENERATORS",
);

const isMapView = (tool: MapTool): tool is MapPanelView =>
  tool === "FLEET" || tool === "AGREEMENTS";

/** Keep the terrain mounted beneath the open map tools. */
export default function MapWorkspace({
  memory: sharedMemory,
}: {
  memory?: Map<string, unknown>;
}) {
  const dispatch = useAppDispatch();
  const card = useAppSelector((state) => state.card);
  const settings = useAppSelector((state) => state.settings);
  const candidate = gameToolForCard(card.name);
  const [projectBusy, setProjectBusy] = React.useState(false);
  const requestedPanel: MapTool | undefined =
    card.name === "FLEET" || card.name === "AGREEMENTS"
      ? card.name
      : candidate === "BUILD_GENERATORS"
        ? undefined
        : candidate;
  const requestedProject = candidate === "BUILD_GENERATORS";
  const destination = projectBusy ? undefined : requestedPanel;
  const localMemory = React.useRef(new Map<string, unknown>());
  const memory = sharedMemory ?? localMemory.current;
  const workspace = React.useRef<HTMLDivElement>(null);
  const tray = React.useRef<HTMLDivElement>(null);
  const area = useMapWindowArea(tray);
  const retainFocus = React.useRef(false);

  const [programBack, setProgramBack] = React.useState<() => void>();
  const presentation = useWorkspaceLayout(workspace, settings);
  const { effectiveWidth } = presentation;
  const desktopMap = effectiveWidth >= SIDE_TOOL_MIN_WIDTH;
  const controllerInput = useControllerInput();
  const floating = presentation.layout === "side" && !controllerInput;
  const [stack, setStack] = React.useState<{
    card: typeof card;
    destination?: MapTool;
    tools: MapTool[];
  }>(() => ({ card, destination, tools: destination ? [destination] : [] }));
  const openPanels = floating ? stack.tools : stack.tools.slice(-1);
  const active = openPanels.at(-1);
  // Card navigation opens or selects a tool. A click inside an existing window
  // only changes the stack, so it does not add a game navigation entry.
  if (card !== stack.card || destination !== stack.destination) {
    setStack({
      card,
      destination,
      tools: destination
        ? [
            ...(floating
              ? openPanels.filter((tool) => tool !== destination)
              : []),
            destination,
          ]
        : [],
    });
  }
  React.useLayoutEffect(() => {
    if (!desktopMap) return;
    const frame = workspace.current;
    const header = frame?.querySelector("#appbar");
    if (!frame || !header) return;
    // Both notification systems render outside the workspace, and the header can
    // gain or lose rows independently of the viewport size.
    const style = document.documentElement.style;
    const measure = () =>
      style.setProperty(
        "--desktop-map-notification-top",
        `${header.getBoundingClientRect().bottom + 8}px`,
      );
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(header);
    observer?.observe(frame);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      style.removeProperty("--desktop-map-notification-top");
    };
  }, [desktopMap, settings.screenEdgePadding]);
  useToolFocusMemory(workspace, memory, active ?? "fleet", "map");
  const returnToMap = React.useCallback(
    () => dispatch(navigate("FACILITIES")),
    [dispatch],
  );
  React.useLayoutEffect(() => {
    if (projectBusy && (requestedPanel || requestedProject)) returnToMap();
  }, [projectBusy, requestedPanel, requestedProject, returnToMap]);
  const close = React.useCallback(
    (tool: MapTool) => {
      const remaining = openPanels.filter((item) => item !== tool);
      setStack({ card, destination, tools: remaining });
      if (!floating || tool === destination) {
        retainFocus.current = true;
        dispatch(navigate(remaining.at(-1) ?? "FACILITIES"));
      }
      const trigger = MAP_TOOLS.find((item) => item.id === tool)!.triggerId;
      document.getElementById(trigger)?.focus({ preventScroll: true });
    },
    [card, destination, dispatch, floating, openPanels],
  );
  const toggleTool = (tool: GameTool | MapPanelView) => {
    if (projectBusy) return;
    if (tool !== "BUILD_GENERATORS" && openPanels.includes(tool)) close(tool);
    else dispatch(navigate(tool));
  };
  const raise = (tool: MapTool) => {
    if (!floating) return;
    setStack((current) =>
      current.tools.at(-1) === tool || !current.tools.includes(tool)
        ? current
        : {
            ...current,
            tools: [...current.tools.filter((item) => item !== tool), tool],
          },
    );
  };
  React.useLayoutEffect(() => {
    if (active && !floating && document.activeElement === document.body)
      workspace.current
        ?.querySelector<HTMLElement>(`#tool-${active} .gameToolTitle`)
        ?.focus({ preventScroll: true });
  }, [active, floating]);
  React.useEffect(() => {
    if (retainFocus.current) retainFocus.current = false;
    else if (destination)
      workspace.current
        ?.querySelector<HTMLElement>(`#tool-${destination} .gameToolTitle`)
        ?.focus({ preventScroll: true });
  }, [card, destination]);
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.defaultPrevented ||
        !active ||
        hasVisibleEscapeOverlay()
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (active === "PROGRAMS" && programBack) programBack();
      else close(active);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active, close, programBack]);
  const panelOpen = openPanels.length > 0;
  const panel = React.useMemo(
    () => ({
      open: panelOpen,
      inspect: returnToMap,
      projectRequested: !projectBusy && requestedProject,
      onProjectBusyChange: setProjectBusy,
    }),
    [panelOpen, returnToMap, projectBusy, requestedProject],
  );
  return (
    <GameToolMemoryContext.Provider value={memory}>
      <GameWorkspaceContext.Provider value={true}>
        <GameWorkspaceLayoutContext.Provider
          value={{
            ...presentation,
            capacity: floating ? MAP_TOOLS.length : 1,
            fleetVisible: openPanels.includes("FLEET"),
          }}
        >
          <MapWorkspacePanelContext.Provider value={panel}>
            <BuildForecastProvider>
              <div
                className="gameWorkspace"
                data-map-workspace="true"
                data-persistent-map="true"
                data-desktop-map={desktopMap || undefined}
                data-map-windows={floating || undefined}
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
                <GameAppBar
                  eventStatus={
                    desktopMap && (
                      <MapEventStatus
                        open={openPanels.includes("EVENTS")}
                        onToggle={toggleTool}
                      />
                    )
                  }
                />
                <div
                  className="gameStage"
                  data-layout="map"
                  data-panel-count={openPanels.length}
                >
                  <div className="gameFleet gameMapStage" data-chart-viewport>
                    <Facilities
                      paneId="mapPane"
                      territoryView="FACILITIES"
                      onTerritoryView={(view) => {
                        if (view !== "FACILITIES" && openPanels.includes(view))
                          raise(view);
                        else dispatch(navigate(view));
                      }}
                    />
                  </div>
                  <div className="gameToolTray" ref={tray}>
                    {MAP_TOOLS.map((tool, slot) => {
                      const stackingIndex = openPanels.indexOf(tool.id);
                      if (stackingIndex < 0) return null;
                      const closePanel = () => close(tool.id);
                      return (
                        <MapPanelWindow
                          key={tool.id}
                          tool={tool.id}
                          label={tool.label}
                          icon={tool.icon}
                          stackingIndex={stackingIndex}
                          front={tool.id === active}
                          floating={
                            floating
                              ? {
                                  area,
                                  slot,
                                  defaultWidth: presentation.toolWidth,
                                  scale: presentation.scale,
                                }
                              : undefined
                          }
                          onRaise={() => raise(tool.id)}
                          onClose={closePanel}
                          onBack={
                            tool.id === "PROGRAMS" ? programBack : undefined
                          }
                        >
                          <GameToolCloseContext.Provider value={closePanel}>
                            {isMapView(tool.id) && (
                              <Facilities
                                territoryView={tool.id}
                                paneId={
                                  tool.id === "AGREEMENTS"
                                    ? "agreementsPane"
                                    : undefined
                                }
                              />
                            )}
                            {tool.id === "PROGRAMS" && (
                              <Programs
                                onClose={closePanel}
                                onBackChange={setProgramBack}
                              />
                            )}
                            {tool.id === "INSIGHTS" && <Insights />}
                            {tool.id === "EVENTS" && <EventLog />}
                            {tool.id === "SCENARIO" && <ScenarioDetails />}
                          </GameToolCloseContext.Provider>
                        </MapPanelWindow>
                      );
                    })}
                  </div>
                </div>
                <Navigation
                  showMapBuild={!desktopMap}
                  showEventStatus={!desktopMap}
                  openMapViews={openPanels.filter(isMapView)}
                  onToggleMapView={toggleTool}
                  openTools={openPanels.filter((tool) => !isMapView(tool))}
                  onToggle={toggleTool}
                />
              </div>
            </BuildForecastProvider>
          </MapWorkspacePanelContext.Provider>
        </GameWorkspaceLayoutContext.Provider>
      </GameWorkspaceContext.Provider>
    </GameToolMemoryContext.Provider>
  );
}
