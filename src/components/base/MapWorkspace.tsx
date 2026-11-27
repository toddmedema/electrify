import * as React from "react";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate, tutorialViewedMapTool } from "../../reducers/GameActions";
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
type MapWindow = MapTool | "TILE";
const isDockTool = (item: MapWindow): item is MapTool => item !== "TILE";
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
  const tutorialStep = useAppSelector((state) => state.game.tutorialStep);
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
  const tileClose = React.useRef<() => void>();
  const projectClose = React.useRef<() => void>();
  const [projectOpen, setProjectOpen] = React.useState(false);
  const showProject = React.useCallback((close: () => void) => {
    projectClose.current = close;
    setProjectOpen(true);
  }, []);
  const hideProject = React.useCallback(() => {
    projectClose.current = undefined;
    setProjectOpen(false);
  }, []);
  const [stack, setStack] = React.useState<{
    card: typeof card;
    destination?: MapTool;
    windows: MapWindow[];
    raisedToClose?: boolean;
  }>(() => ({ card, destination, windows: destination ? [destination] : [] }));
  const windows = floating ? stack.windows : stack.windows.slice(-1);
  const openPanels = windows.filter(isDockTool);
  const active = windows.at(-1);
  // Navigation remembers the last dock tool even when a tile covers it. Teach
  // the tool the player actually sees, excluding the temporary raise on Close.
  const viewed = stack.raisedToClose ? undefined : active;
  React.useEffect(() => {
    if (tutorialStep >= 0 && viewed && isDockTool(viewed))
      dispatch(tutorialViewedMapTool(viewed));
  }, [dispatch, tutorialStep, viewed]);
  // Selecting a destination brings it forward. Closing a window can also change
  // the card, but the remaining windows keep their order.
  if (card !== stack.card || destination !== stack.destination) {
    const retained =
      floating && retainFocus.current
        ? windows
        : destination
          ? [
              ...(floating
                ? windows.filter((item) => item !== destination)
                : []),
              destination,
            ]
          : windows.filter((item) => item === "TILE");
    setStack({ card, destination, windows: retained });
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
    (tool: MapTool, focusTrigger = true) => {
      const remaining = windows.filter((item) => item !== tool);
      setStack({ card, destination, windows: remaining });
      if (!floating || tool === destination) {
        retainFocus.current = true;
        dispatch(navigate(remaining.findLast(isDockTool) ?? "FACILITIES"));
      }
      if (!focusTrigger) return;
      const trigger = MAP_TOOLS.find((item) => item.id === tool)!.triggerId;
      document.getElementById(trigger)?.focus({ preventScroll: true });
    },
    [card, destination, dispatch, floating, windows],
  );
  const raise = React.useCallback(
    (item: MapWindow, raisedToClose = false) => {
      if (!floating) return;
      setStack((current) =>
        !current.windows.includes(item) ||
        (current.windows.at(-1) === item &&
          !!current.raisedToClose === raisedToClose)
          ? current
          : {
              ...current,
              raisedToClose,
              windows: [
                ...current.windows.filter((window) => window !== item),
                item,
              ],
            },
      );
    },
    [floating],
  );
  const focusHeading = React.useCallback((item: MapWindow) => {
    workspace.current
      ?.querySelector<HTMLElement>(`#tool-${item} .gameToolTitle`)
      ?.focus({ preventScroll: true });
  }, []);
  const toggleTool = (tool: GameTool | MapPanelView) => {
    if (projectBusy) return;
    if (tool === "BUILD_GENERATORS" && projectClose.current) {
      projectClose.current();
      return;
    }
    if (tool !== "BUILD_GENERATORS" && openPanels.includes(tool)) {
      if (floating && tool !== active) {
        raise(tool);
        focusHeading(tool);
      } else close(tool);
    } else dispatch(navigate(tool));
  };
  const showTile = React.useCallback((dismiss: () => void) => {
    tileClose.current = dismiss;
    setStack((current) =>
      current.windows.includes("TILE")
        ? current
        : {
            ...current,
            raisedToClose: false,
            windows: [...current.windows, "TILE"],
          },
    );
  }, []);
  const hideTile = React.useCallback(() => {
    tileClose.current = undefined;
    setStack((current) =>
      current.windows.includes("TILE")
        ? {
            ...current,
            raisedToClose: false,
            windows: current.windows.filter(isDockTool),
          }
        : current,
    );
  }, []);
  React.useLayoutEffect(() => {
    if (active && !floating && document.activeElement === document.body)
      focusHeading(active);
  }, [active, floating, focusHeading]);
  React.useEffect(() => {
    if (retainFocus.current) retainFocus.current = false;
    else if (destination) focusHeading(destination);
  }, [card, destination, focusHeading]);
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.repeat ||
        event.defaultPrevented ||
        !active ||
        (active === "TILE" && !floating) ||
        hasVisibleEscapeOverlay()
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (active === "TILE") tileClose.current?.();
      else if (active === "PROGRAMS" && programBack) programBack();
      else close(active);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [active, close, floating, programBack]);
  const panelOpen = openPanels.length > 0;
  const inspectionIndex = windows.indexOf("TILE");
  const inspectionFront = active === "TILE";
  const panel = React.useMemo(
    () => ({
      open: panelOpen,
      returnToMap,
      showTile,
      hideTile,
      tileWindow: floating
        ? {
            tray,
            stackingIndex: inspectionIndex,
            front: inspectionFront,
            raise: () => raise("TILE"),
          }
        : undefined,
      projectRequested: !projectBusy && requestedProject,
      showProject,
      hideProject,
      onProjectBusyChange: setProjectBusy,
    }),
    [
      floating,
      hideTile,
      inspectionFront,
      inspectionIndex,
      panelOpen,
      projectBusy,
      raise,
      requestedProject,
      returnToMap,
      showTile,
      showProject,
      hideProject,
    ],
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
                  scenarioOpen={openPanels.includes("SCENARIO")}
                  onCloseScenario={() => close("SCENARIO", false)}
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
                  data-panel-count={
                    floating ? windows.length : openPanels.length
                  }
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
                      const stackingIndex = windows.indexOf(tool.id);
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
                          onRaise={(toClose) => raise(tool.id, toClose)}
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
                  openTools={[
                    ...openPanels.filter((tool) => !isMapView(tool)),
                    ...(projectOpen ? (["BUILD_GENERATORS"] as const) : []),
                  ]}
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
