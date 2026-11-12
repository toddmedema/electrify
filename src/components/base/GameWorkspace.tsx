import * as React from "react";
import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { BuildForecastProvider } from "./BuildForecast";
import {
  GameToolMemoryContext,
  useToolFocusMemory,
  useToolScroll,
} from "./GameToolMemory";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { selectTutorialActions } from "../../reducers/Tutorial";
import { CardNameType } from "../../Types";
import { useWorkspaceLayout } from "../../WorkspaceLayout";
import GameAppBar from "./GameAppBar";
import Navigation, {
  GAME_TOOLS,
  GameTool,
  gameToolForCard,
} from "./Navigation";
import Facilities from "../views/FacilitiesContainer";
import Insights from "../views/InsightsContainer";
import EventLog from "../views/EventLogContainer";
import BuildFacilities from "../views/BuildFacilities";
import Programs from "../views/Programs";
import ScenarioDetails from "./ScenarioDetails";
import {
  GameWorkspaceContext,
  GameToolCloseContext,
  GameBuildCompleteContext,
  GameWorkspaceLayoutContext,
} from "./GameWorkspaceContext";
import "./GameWorkspace.scss";

type ToolSide = "decision" | "intelligence";
const sideFor = (tool: GameTool): ToolSide =>
  tool === "BUILD_GENERATORS" || tool === "PROGRAMS"
    ? "decision"
    : "intelligence";

export {
  SIDE_TOOL_MIN_WIDTH,
  MIN_FLEET_WIDTH,
  maxOpenTools,
  toolWidth,
} from "../../WorkspaceLayout";

/** The dock's button width at this window width; keep in step with GameWorkspace.scss. */
function dockButtonWidth(width: number): number {
  return width >= 2200 ? 104 : width >= 1600 ? 88 : 72;
}

/** Five actions, their gaps, the dock's padding and border, and a margin each side. */
export function dockClearanceWidth(width: number, scale = 1): number {
  return (
    (5 * dockButtonWidth(width / scale) + 4 * 4 + 2 * 4 + 2 + 2 * 8) * scale
  );
}

/**
 * Where to centre the dock when the window centre would put it over a side tool: the middle of
 * the free stage. Undefined when the window centre is clear.
 */
export function dockCenter(
  width: number,
  leftTools: number,
  rightTools: number,
  tool: number,
  scale = 1,
): number | undefined {
  const start = leftTools * tool;
  const end = width - rightTools * tool;
  const half = dockClearanceWidth(width, scale) / 2;
  return width / 2 - half >= start && width / 2 + half <= end
    ? undefined
    : (start + end) / 2;
}

/**
 * Side columns protect fleet space; constrained screens give one tool the main area. Wide screens
 * keep several tools open at once, as many as fit beside a phone-width fleet. Decision tools sit
 * left of the fleet and intelligence tools right of it, each in action bar order, so opening
 * another never moves the ones already open.
 */
export default function GameWorkspace({
  memory,
}: { memory?: Map<string, unknown> } = {}) {
  return <Workspace memory={memory} />;
}

function Workspace({
  memory: sharedMemory,
}: {
  memory?: Map<string, unknown>;
}) {
  const dispatch = useAppDispatch();
  const card = useAppSelector((state) => state.card.name);
  const active = gameToolForCard(card);
  const settings = useAppSelector((state) => state.settings);
  const tutorialActions = useAppSelector(selectTutorialActions);
  // Open tools, least recently opened first. The newest ones win when they don't all fit.
  const [remembered, setRemembered] = React.useState<GameTool[]>([]);
  const [buildCategory, setBuildCategory] =
    React.useState<CardNameType>("BUILD_GENERATORS");
  const headings = React.useRef(new Map<GameTool, HTMLHeadingElement>());
  const localMemory = React.useRef(new Map<string, unknown>());
  const memory = sharedMemory ?? localMemory.current;
  const workspace = React.useRef<HTMLDivElement>(null);
  useToolFocusMemory(workspace, memory, active ?? "fleet");
  const [programBack, setProgramBack] = React.useState<() => void>();
  const retainFocus = React.useRef(false);
  const presentation = useWorkspaceLayout(workspace, settings);
  const { layout, capacity, width, scale, effectiveWidth } = presentation;
  const fleetVisible = layout === "side" || !active;
  // Capture focus before a disappearing column unmounts its children. A scale or inset change
  // can collapse columns without a window resize; the control being edited wins that collapse.
  const previousCapacity = React.useRef(capacity);
  const retainedTool =
    capacity < previousCapacity.current
      ? (document.activeElement?.closest<HTMLElement>("[data-game-tool]")
          ?.dataset.gameTool as GameTool | undefined)
      : undefined;
  const requested = retainedTool ?? active;
  // Derive the newly requested tool immediately; remembering it in an effect must not flash
  // the previous rail or unmount the fleet during navigation.
  const tools: GameTool[] = (
    requested
      ? [...remembered.filter((tool) => tool !== requested), requested]
      : []
  ).filter((tool) => !tutorialActions || tutorialActions.includes(tool));
  const visible = tools.slice(-capacity);
  const ordered = GAME_TOOLS.map((tool) => tool.id).filter((id) =>
    tools.includes(id),
  );
  const shownOnSide = (side: ToolSide) =>
    ordered.filter((tool) => visible.includes(tool) && sideFor(tool) === side);
  const left = shownOnSide("decision");
  const right = shownOnSide("intelligence");
  const dockLeft =
    layout === "side"
      ? dockCenter(
          width,
          left.length,
          right.length,
          presentation.toolWidth,
          scale,
        )
      : undefined;
  React.useLayoutEffect(() => {
    previousCapacity.current = capacity;
    if (retainedTool && retainedTool !== active) {
      retainFocus.current = true;
      dispatch(
        navigate(
          retainedTool === "BUILD_GENERATORS" ? buildCategory : retainedTool,
        ),
      );
    }
  }, [capacity, retainedTool, active, buildCategory, dispatch]);
  React.useLayoutEffect(() => {
    // Keep focus in the active tool when the layout changes, without stealing it
    // from a retained pricing slider or chart.
    if (active && document.activeElement === document.body) {
      headings.current.get(active)?.focus({ preventScroll: true });
    }
  }, [layout, active]);
  React.useEffect(() => {
    if (card.startsWith("BUILD_")) setBuildCategory(card);
    if (active)
      setRemembered((current) => [
        ...current.filter((tool) => tool !== active),
        active,
      ]);
    else setRemembered([]);
  }, [card, active]);
  React.useEffect(() => {
    if (retainFocus.current) retainFocus.current = false;
    else if (active) {
      headings.current.get(active)?.focus({ preventScroll: true });
    }
  }, [active]);
  const destination = (tool: GameTool) =>
    tool === "BUILD_GENERATORS" ? buildCategory : tool;
  const close = (tool: GameTool) => {
    // Only what is on screen stays open; a tool that didn't fit is not revealed by closing another.
    const remaining = visible.filter((item) => item !== tool);
    setRemembered(remaining);
    if (active === tool) {
      retainFocus.current = true;
      const next = remaining[remaining.length - 1];
      dispatch(navigate(next ? destination(next) : "FACILITIES"));
    }
    document
      .getElementById(GAME_TOOLS.find((item) => item.id === tool)!.triggerId)
      ?.focus({ preventScroll: true });
  };
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector(
          '.MuiModal-root:not(.MuiModal-hidden), [data-manual-help="true"], [data-scenario-choice="true"], [data-data-center-guide="true"]',
        )
      )
        return;
      const panel = (event.target as HTMLElement)?.closest<HTMLElement>(
        "[data-game-tool]",
      );
      const target =
        (panel?.dataset.gameTool as GameTool | undefined) ?? active;
      if (!target) return;
      if (
        target === "PROGRAMS" &&
        document.querySelector('[data-program-decision="true"]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close(target);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });
  return (
    <GameToolMemoryContext.Provider value={memory}>
      <GameWorkspaceContext.Provider value={true}>
        <GameWorkspaceLayoutContext.Provider
          value={{ ...presentation, fleetVisible }}
        >
          <BuildForecastProvider>
            <div
              className="gameWorkspace"
              data-workspace-layout={layout}
              data-compact-dock={effectiveWidth < 700}
              data-dock-size={
                effectiveWidth >= 2200
                  ? "large"
                  : effectiveWidth >= 1600
                    ? "medium"
                    : "normal"
              }
              ref={workspace}
              style={
                dockLeft === undefined
                  ? undefined
                  : { ["--game-dock-left" as string]: `${dockLeft}px` }
              }
            >
              <GameAppBar />
              <div
                className="gameStage"
                data-layout={layout}
                data-panel-count={visible.length}
                style={
                  layout === "side" && visible.length
                    ? {
                        ["--game-tool-width" as string]: `${presentation.toolWidth}px`,
                        gridTemplateColumns: [
                          ...left.map(() => "var(--game-tool-width)"),
                          `minmax(${presentation.minFleetWidth}px, 1fr)`,
                          ...right.map(() => "var(--game-tool-width)"),
                        ].join(" "),
                      }
                    : undefined
                }
              >
                <div
                  className="gameFleet"
                  hidden={!fleetVisible}
                  style={
                    layout === "side"
                      ? { gridColumn: left.length + 1 }
                      : undefined
                  }
                >
                  <Facilities />
                </div>
                <div className="gameToolTray">
                  {ordered.map((tool) => {
                    const config = GAME_TOOLS.find((item) => item.id === tool)!;
                    const shown = visible.includes(tool);
                    const side = sideFor(tool);
                    const column =
                      side === "decision"
                        ? left.indexOf(tool) + 1
                        : left.length + 2 + right.indexOf(tool);
                    return (
                      <section
                        key={tool}
                        id={`tool-${tool}`}
                        className="gameToolPanel"
                        aria-label={config.label}
                        data-game-tool={tool}
                        data-tool-side={side}
                        hidden={!shown}
                        style={
                          layout === "side" && shown
                            ? { gridColumn: column }
                            : undefined
                        }
                      >
                        <header className="gameToolHeader">
                          {tool === "PROGRAMS" && programBack && (
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
                            ref={(node) => {
                              if (node) headings.current.set(tool, node);
                              else headings.current.delete(tool);
                            }}
                          >
                            <span className="gameToolTitleIcon">
                              {config.icon}
                            </span>
                            {config.label}
                          </h2>
                          <IconButton
                            aria-label={`Close ${config.label}`}
                            onClick={() => close(tool)}
                          >
                            <CloseIcon />
                          </IconButton>
                        </header>
                        <ToolBody tool={tool}>
                          {/* Hidden compact rails release decision pause tokens; the visible tool keeps
                      its DOM, input focus and scroll position when it moves into a side column. */}
                          {shown && (
                            <GameToolCloseContext.Provider
                              value={() => close(tool)}
                            >
                              {tool === "BUILD_GENERATORS" && (
                                <GameBuildCompleteContext.Provider
                                  value={() => {
                                    if (layout !== "side") close(tool);
                                  }}
                                >
                                  <BuildFacilities
                                    embedded
                                    category={
                                      card.startsWith("BUILD_")
                                        ? card
                                        : buildCategory
                                    }
                                  />
                                </GameBuildCompleteContext.Provider>
                              )}
                              {tool === "PROGRAMS" && (
                                <Programs
                                  onClose={() => close(tool)}
                                  onBackChange={setProgramBack}
                                />
                              )}
                              {tool === "INSIGHTS" && <Insights />}
                              {tool === "EVENTS" && <EventLog />}
                              {tool === "SCENARIO" && <ScenarioDetails />}
                            </GameToolCloseContext.Provider>
                          )}
                        </ToolBody>
                      </section>
                    );
                  })}
                </div>
              </div>
              <Navigation
                openTools={visible}
                onToggle={(tool) => {
                  if (visible.includes(tool)) close(tool);
                  else dispatch(navigate(destination(tool)));
                }}
              />
            </div>
          </BuildForecastProvider>
        </GameWorkspaceLayoutContext.Provider>
      </GameWorkspaceContext.Provider>
    </GameToolMemoryContext.Provider>
  );
}

function ToolBody({
  tool,
  children,
}: {
  tool: GameTool;
  children: React.ReactNode;
}) {
  const ref = useToolScroll<HTMLDivElement>(`workspace.${tool}.scroll`);
  return (
    <div className="gameToolBody" ref={ref}>
      {children}
    </div>
  );
}
