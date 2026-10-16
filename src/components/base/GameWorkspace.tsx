import * as React from "react";
import { IconButton, Button } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import PushPinIcon from "@mui/icons-material/PushPin";
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
import { GameWorkspaceContext } from "./GameWorkspaceContext";
import "./GameWorkspace.scss";

export function gameToolCapacity(width: number): number {
  return width >= 2100 ? 3 : width >= 1440 ? 2 : 1;
}

/** Keep the active tool visible when narrowing without throwing away pinned tools. */
export function visibleGameTools(
  pinned: GameTool[],
  active: GameTool | undefined,
  capacity: number,
): GameTool[] {
  const others = pinned.filter((tool) => tool !== active);
  return active
    ? [
        ...others
          .slice(Math.max(0, others.length - capacity + 1))
          .slice(0, capacity - 1),
        active,
      ]
    : others.slice(-capacity);
}

export default function GameWorkspace() {
  const dispatch = useAppDispatch();
  const card = useAppSelector((state) => state.card.name);
  const [pinned, setPinned] = React.useState<GameTool[]>([]);
  const [width, setWidth] = React.useState(window.innerWidth);
  const [buildCategory, setBuildCategory] =
    React.useState<CardNameType>("BUILD_GENERATORS");
  const headings = React.useRef(new Map<GameTool, HTMLHeadingElement>());
  const closing = React.useRef(false);
  const active = gameToolForCard(card);
  const capacity = gameToolCapacity(width);
  const visible = visibleGameTools(pinned, active, capacity);
  React.useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  React.useEffect(() => {
    if (card.startsWith("BUILD_")) setBuildCategory(card);
    if (card === "FACILITIES") setPinned([]);
  }, [card]);
  React.useEffect(() => {
    if (closing.current) closing.current = false;
    else if (active)
      headings.current.get(active)?.focus({ preventScroll: true });
  }, [active]);
  const close = React.useCallback(
    (tool: GameTool) => {
      const remaining = pinned.filter((item) => item !== tool);
      setPinned(remaining);
      if (tool === active) {
        closing.current = true;
        const next = remaining[remaining.length - 1];
        dispatch(
          navigate(
            next === "BUILD_GENERATORS"
              ? buildCategory
              : (next ?? "FACILITIES"),
          ),
        );
      }
      document
        .getElementById(GAME_TOOLS.find((item) => item.id === tool)!.triggerId)
        ?.focus({ preventScroll: true });
    },
    [active, dispatch, pinned, buildCategory],
  );
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
      const tool = panel?.dataset.gameTool as GameTool | undefined;
      const target = tool ?? active ?? visible[visible.length - 1];
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
  }, [active, visible, close]);
  return (
    <GameWorkspaceContext.Provider value={true}>
      <div className="gameWorkspace">
        <GameAppBar />
        <div className="gameStage">
          <Facilities />
          <div className="gameToolTray" data-panel-count={visible.length}>
            {visible.map((tool) => {
              const config = GAME_TOOLS.find((item) => item.id === tool)!;
              const isPinned = pinned.includes(tool);
              return (
                <section
                  key={tool}
                  id={`tool-${tool}`}
                  className="gameToolPanel"
                  aria-label={config.label}
                  data-game-tool={tool}
                >
                  <header className="gameToolHeader">
                    {config.icon}
                    <h2
                      tabIndex={-1}
                      ref={(node) => {
                        if (node) headings.current.set(tool, node);
                        else headings.current.delete(tool);
                      }}
                    >
                      {config.label}
                    </h2>
                    {capacity > 1 && (
                      <Button
                        className="gameToolPin"
                        startIcon={
                          isPinned ? <PushPinIcon /> : <PushPinOutlinedIcon />
                        }
                        aria-label={`${isPinned ? "Unpin" : "Pin"} ${config.label}`}
                        aria-pressed={isPinned}
                        onClick={() =>
                          setPinned(
                            isPinned
                              ? pinned.filter((item) => item !== tool)
                              : [...pinned, tool].slice(-(capacity - 1)),
                          )
                        }
                      >
                        {isPinned ? "Pinned" : "Pin"}
                      </Button>
                    )}
                    <IconButton
                      aria-label={`Close ${config.label}`}
                      onClick={() => close(tool)}
                    >
                      <CloseIcon />
                    </IconButton>
                  </header>
                  <div className="gameToolBody">
                    {tool === "BUILD_GENERATORS" && (
                      <BuildFacilities
                        embedded
                        category={
                          card.startsWith("BUILD_") ? card : buildCategory
                        }
                      />
                    )}
                    {tool === "PROGRAMS" && (
                      <Programs onClose={() => close(tool)} />
                    )}
                    {tool === "INSIGHTS" && <Insights />}
                    {tool === "EVENTS" && <EventLog />}
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
            else
              dispatch(
                navigate(tool === "BUILD_GENERATORS" ? buildCategory : tool),
              );
          }}
        />
      </div>
    </GameWorkspaceContext.Provider>
  );
}
