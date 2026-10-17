import * as React from "react";
import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { GameToolMemoryContext } from "./GameToolMemory";
import { useAppDispatch, useAppSelector } from "../../Store";
import { navigate } from "../../reducers/Card";
import { CardNameType } from "../../Types";
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
import {
  GameWorkspaceContext,
  GameToolCloseContext,
} from "./GameWorkspaceContext";
import "./GameWorkspace.scss";

type ToolGroup = "decision" | "intelligence";
type ToolSelections = Partial<Record<ToolGroup, GameTool>>;
const TOOL_GROUPS: { id: ToolGroup }[] = [
  { id: "decision" },
  { id: "intelligence" },
];
const groupFor = (tool: GameTool): ToolGroup =>
  tool === "BUILD_GENERATORS" || tool === "PROGRAMS"
    ? "decision"
    : "intelligence";

/** Side columns protect fleet space; compact screens use one sheet over the stage. */
export default function GameWorkspace() {
  const dispatch = useAppDispatch();
  const card = useAppSelector((state) => state.card.name);
  const active = gameToolForCard(card);
  const [remembered, setRemembered] = React.useState<ToolSelections>({});
  const [width, setWidth] = React.useState(window.innerWidth);
  const [buildCategory, setBuildCategory] =
    React.useState<CardNameType>("BUILD_GENERATORS");
  const headings = React.useRef(new Map<GameTool, HTMLHeadingElement>());
  const memory = React.useRef(new Map<string, unknown>());
  const [programBack, setProgramBack] = React.useState<() => void>();
  const retainFocus = React.useRef(false);
  const layout = width >= 1800 ? "dual" : width >= 1200 ? "side" : "sheet";
  // Derive the newly requested tool immediately; remembering it in an effect must not flash
  // the previous rail or unmount the fleet during navigation.
  const selections: ToolSelections = active
    ? { ...remembered, [groupFor(active)]: active }
    : {};
  const visibleGroups = TOOL_GROUPS.filter(
    (group) =>
      selections[group.id] &&
      (layout === "dual" || group.id === (active && groupFor(active))),
  );
  const visible = visibleGroups.map((group) => selections[group.id]!);
  React.useEffect(() => {
    const resize = () => {
      // Keep the rail the player is working in when two columns collapse to one.
      const focused =
        document.activeElement?.closest<HTMLElement>("[data-game-tool]");
      const tool = focused?.dataset.gameTool as GameTool | undefined;
      if (window.innerWidth < 1800 && tool && tool !== active) {
        retainFocus.current = true;
        dispatch(navigate(tool === "BUILD_GENERATORS" ? buildCategory : tool));
      }
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [active, buildCategory, dispatch]);
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
      setRemembered((current) => ({ ...current, [groupFor(active)]: active }));
    else setRemembered({});
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
    const group = groupFor(tool);
    const remaining = { ...selections };
    delete remaining[group];
    setRemembered(remaining);
    if (active && groupFor(active) === group) {
      retainFocus.current = true;
      const next = visible.find((item) => groupFor(item) !== group);
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
        <div className="gameWorkspace">
          <GameAppBar />
          <div
            className="gameStage"
            data-layout={layout}
            data-panel-count={visible.length}
            data-decision-open={
              visibleGroups.some((group) => group.id === "decision") ||
              undefined
            }
            data-intelligence-open={
              visibleGroups.some((group) => group.id === "intelligence") ||
              undefined
            }
          >
            <div className="gameFleet">
              <Facilities />
            </div>
            <div className="gameToolTray">
              {TOOL_GROUPS.map((group) => {
                const tool = selections[group.id];
                if (!tool) return null;
                const config = GAME_TOOLS.find((item) => item.id === tool)!;
                const shown = visibleGroups.includes(group);
                return (
                  <section
                    key={group.id}
                    id={`tool-${tool}`}
                    className="gameToolPanel"
                    aria-label={config.label}
                    data-game-tool={tool}
                    data-tool-group={group.id}
                    hidden={!shown}
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
                            <BuildFacilities
                              embedded
                              category={
                                card.startsWith("BUILD_") ? card : buildCategory
                              }
                            />
                          )}
                          {tool === "PROGRAMS" && (
                            <Programs
                              onClose={() => close(tool)}
                              onBackChange={setProgramBack}
                            />
                          )}
                          {tool === "INSIGHTS" && <Insights />}
                          {tool === "EVENTS" && <EventLog />}
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
