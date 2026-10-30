import * as React from "react";
import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { GameToolMemoryContext } from "./GameToolMemory";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { selectTutorialActions } from "../../reducers/Tutorial";
import { CardNameType } from "../../Types";
import { SIDE_TOOL_MIN_WIDTH } from "../../Globals";
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
} from "./GameWorkspaceContext";
import "./GameWorkspace.scss";

type ToolSide = "decision" | "intelligence";
const sideFor = (tool: GameTool): ToolSide =>
  tool === "BUILD_GENERATORS" || tool === "PROGRAMS"
    ? "decision"
    : "intelligence";

/** Below this, tools rise as one sheet over the fleet instead of taking their own columns. */
export { SIDE_TOOL_MIN_WIDTH };
/** The fleet never gets narrower than the widest common phone, so it stays fully usable. */
export const MIN_FLEET_WIDTH = 430;
const MIN_TOOL_WIDTH = 360;
const MAX_TOOL_WIDTH = 480;

/** Sets --game-tool-width: 28vw within its limits, in whole pixels so text stays sharp. */
export function toolWidth(width: number) {
  return Math.round(
    Math.min(MAX_TOOL_WIDTH, Math.max(MIN_TOOL_WIDTH, width * 0.28)),
  );
}

/** Five 72px actions, their gaps, the dock's padding and border, and a margin each side. */
const DOCK_CLEARANCE_WIDTH = 402;

/**
 * Where to centre the dock when the window centre would put it over a side tool: the middle of
 * the free stage. Undefined when the window centre is clear.
 */
export function dockCenter(
  width: number,
  leftTools: number,
  rightTools: number,
  tool: number,
): number | undefined {
  const start = leftTools * tool;
  const end = width - rightTools * tool;
  const half = DOCK_CLEARANCE_WIDTH / 2;
  return width / 2 - half >= start && width / 2 + half <= end
    ? undefined
    : (start + end) / 2;
}

/** How many tools fit beside the fleet at this window width, keeping it at phone width or more. */
export function maxOpenTools(width: number) {
  if (width < SIDE_TOOL_MIN_WIDTH) return 1;
  return Math.max(
    1,
    Math.min(
      GAME_TOOLS.length,
      Math.floor((width - MIN_FLEET_WIDTH) / toolWidth(width)),
    ),
  );
}

/**
 * Side columns protect fleet space; compact screens use one sheet over the stage. Wide screens
 * keep several tools open at once, as many as fit beside a phone-width fleet. Decision tools sit
 * left of the fleet and intelligence tools right of it, each in action bar order, so opening
 * another never moves the ones already open.
 */
export default function GameWorkspace() {
  const dispatch = useAppDispatch();
  const card = useAppSelector((state) => state.card.name);
  const active = gameToolForCard(card);
  const tutorialActions = useAppSelector(selectTutorialActions);
  // Open tools, least recently opened first. The newest ones win when they don't all fit.
  const [remembered, setRemembered] = React.useState<GameTool[]>([]);
  const [width, setWidth] = React.useState(window.innerWidth);
  const [buildCategory, setBuildCategory] =
    React.useState<CardNameType>("BUILD_GENERATORS");
  const headings = React.useRef(new Map<GameTool, HTMLHeadingElement>());
  const memory = React.useRef(new Map<string, unknown>());
  const [programBack, setProgramBack] = React.useState<() => void>();
  const retainFocus = React.useRef(false);
  const layout = width >= SIDE_TOOL_MIN_WIDTH ? "side" : "sheet";
  const capacity = maxOpenTools(width);
  // Derive the newly requested tool immediately; remembering it in an effect must not flash
  // the previous rail or unmount the fleet during navigation.
  const tools: GameTool[] = (
    active ? [...remembered.filter((tool) => tool !== active), active] : []
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
      ? dockCenter(width, left.length, right.length, toolWidth(width))
      : undefined;
  const resizeState = React.useRef({ active, tools, buildCategory });
  React.useLayoutEffect(() => {
    resizeState.current = { active, tools, buildCategory };
  });
  React.useEffect(() => {
    const resize = () => {
      const { active, tools, buildCategory } = resizeState.current;
      // Keep the rail the player is working in when columns collapse.
      const focused =
        document.activeElement?.closest<HTMLElement>("[data-game-tool]");
      const tool = focused?.dataset.gameTool as GameTool | undefined;
      if (
        tool &&
        tool !== active &&
        !tools.slice(-maxOpenTools(window.innerWidth)).includes(tool)
      ) {
        retainFocus.current = true;
        dispatch(navigate(tool === "BUILD_GENERATORS" ? buildCategory : tool));
      }
      setWidth(window.innerWidth);
    };
    // An earlier resize listener can synchronously redraw the workspace. Keep this
    // subscription in place so that redraw cannot remove it from the current event.
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [dispatch]);
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
    <GameToolMemoryContext.Provider value={memory.current}>
      <GameWorkspaceContext.Provider value={true}>
        <div
          className="gameWorkspace"
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
                    ["--game-tool-width" as string]: `${toolWidth(width)}px`,
                    gridTemplateColumns: [
                      ...left.map(() => "var(--game-tool-width)"),
                      `minmax(${MIN_FLEET_WIDTH}px, 1fr)`,
                      ...right.map(() => "var(--game-tool-width)"),
                    ].join(" "),
                  }
                : undefined
            }
          >
            <div
              className="gameFleet"
              style={
                layout === "side" ? { gridColumn: left.length + 1 } : undefined
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
                        <span className="gameToolTitleIcon">{config.icon}</span>
                        {config.label}
                      </h2>
                      <IconButton
                        aria-label={`Close ${config.label}`}
                        onClick={() => close(tool)}
                      >
                        <CloseIcon />
                      </IconButton>
                    </header>
                    <div className="gameToolBody">
                      {/* Hidden compact rails release decision pause tokens; the visible tool keeps
                      its DOM, input focus and scroll position when it moves into a side column. */}
                      {shown && (
                        <GameToolCloseContext.Provider
                          value={() => close(tool)}
                        >
                          {tool === "BUILD_GENERATORS" && (
                            <GameBuildCompleteContext.Provider
                              value={() => {
                                if (layout === "sheet") close(tool);
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
                    </div>
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
      </GameWorkspaceContext.Provider>
    </GameToolMemoryContext.Provider>
  );
}
