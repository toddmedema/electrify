import * as React from "react";
import { Button, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { GameType, isStorage } from "../../Types";
import { useAppDispatch, useAppSelector } from "../../Store";
import { currentTick } from "../../helpers/GameSelectors";
import { formatWatts, formatWattHours } from "../../helpers/Format";
import { getDispatchOrderedFuels } from "../../helpers/Energy";
import { TickThrottle } from "../../helpers/RenderThrottle";
import { isUpgradingAt, upgradeInProgress } from "../../helpers/Hazards";
import { focusEvidence } from "../../helpers/Evidence";
import { reprioritizeFacility, togglePauseFacility } from "../../reducers/Game";
import { selectFacility, snackbarOpen } from "../../reducers/UI";
import BuildFacilities from "../views/BuildFacilities";
import InsightsContainer from "../views/InsightsContainer";
import EventLogContainer from "../views/EventLogContainer";
import ChartSupplyDemand from "./ChartSupplyDemand";
import { chartScale } from "./UPlotHelpers";
import { getGridHealth } from "./GameAppBar";
import "./OperatingStage.scss";

/** Keep the existing fast-speed chart budget after moving it out of the fleet pane. */
class LiveSupplyDemand extends React.Component<{
  game: GameType;
  height: number;
  compact: boolean;
  mini: boolean;
}> {
  private throttle = new TickThrottle();

  shouldComponentUpdate(
    next: Readonly<{
      game: GameType;
      height: number;
      compact: boolean;
      mini: boolean;
    }>,
  ) {
    if (
      next.height !== this.props.height ||
      next.compact !== this.props.compact ||
      next.mini !== this.props.mini ||
      next.game.speed !== this.props.game.speed ||
      (next.game.speed !== "FAST" && next.game.speed !== "ULTRA") ||
      next.game.facilities.map((facility) => facility.id).join("|") !==
        this.props.game.facilities.map((facility) => facility.id).join("|")
    )
      return true;
    return this.throttle.due(next.game.date.minute, 4);
  }

  componentDidUpdate() {
    this.throttle.rendered(this.props.game.date.minute);
  }

  render() {
    const { game, height, compact, mini } = this.props;
    return (
      <ChartSupplyDemand
        height={height}
        compact={compact}
        mini={mini}
        timeline={game.timeline}
        fuelOrder={getDispatchOrderedFuels(game.facilities)}
        currentMinute={game.date.minute}
        location={game.location}
        legend
        startingYear={game.startingYear}
      />
    );
  }
}

/**
 * The live grid stays mounted above whatever the player is working on. Build changes the
 * context below it, while the hidden Insights pane retains its preset, viewport and scroll.
 * This is a view of the existing dispatch simulation, not a new geographic network model.
 */
export default function OperatingStage({
  context,
}: {
  context: "insights" | "events" | "build";
}): React.JSX.Element {
  const dispatch = useAppDispatch();
  const game = useAppSelector((state) => state.game);
  const selectedId = useAppSelector((state) => state.ui.selectedFacilityId);
  const evidence = useAppSelector((state) => state.ui.evidenceRequest);
  const dragging = useAppSelector((state) => state.ui.facilityDragActive);
  const plot = React.useRef<HTMLDivElement>(null);
  const workspace = React.useRef<HTMLDivElement>(null);
  const anchor = React.useRef<HTMLElement>(null);
  const [height, setHeight] = React.useState(220);
  const [compact, setCompact] = React.useState(false);
  const [tight, setTight] = React.useState(false);
  const [mini, setMini] = React.useState(false);
  React.useLayoutEffect(() => {
    const element = plot.current;
    if (!element) return;
    const measure = () => {
      const available = workspace.current?.clientHeight || 0;
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // Budget against the room below the actual HUD and navigation, including larger text.
      // A short context must remain usable even on a physically tall display at 150% size.
      if (available > 0) {
        setCompact(available < 38 * rem);
        setTight(available < 26 * rem);
        setMini(available < 20 * rem);
      }
      const legend = element.querySelector(".chartLegend");
      setHeight(
        Math.max(
          1,
          (element.clientHeight - (legend?.clientHeight || 24) - 8) /
            chartScale(element.clientWidth || 350),
        ),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (workspace.current) observer.observe(workspace.current);
    const legend = element.querySelector(".chartLegend");
    if (legend) observer.observe(legend);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (evidence?.target === "supply-demand" && !dragging) {
      dispatch(focusEvidence(evidence, anchor.current));
    }
  }, [dispatch, evidence, dragging]);
  const now = currentTick(game);
  const index = game.facilities.findIndex(
    (facility) => facility.id === selectedId,
  );
  const selected = game.facilities[index];
  const upgrading =
    selected &&
    !!upgradeInProgress(selected) &&
    isUpgradingAt(selected, game.date.minute);
  const readOnly = !!game.replayPlayback;
  const health = now && getGridHealth(game, now);
  const selectedReading = !selected
    ? ""
    : selected.yearsToBuildLeft > 0
      ? "Under construction"
      : upgrading
        ? "Upgrading"
        : selected.paused
          ? "Paused"
          : selected.currentW === 0
            ? "Idle"
            : `${formatWatts(Math.abs(selected.currentW))} ${isStorage(selected) ? (selected.currentW < 0 ? "charging" : "discharging") : "now"}`;
  const storedReading =
    selected && isStorage(selected)
      ? ` · ${formatWattHours(selected.currentWh)} stored`
      : "";

  const toggle = () => {
    if (!selected) return;
    dispatch(togglePauseFacility(selected.id));
    dispatch(
      snackbarOpen({
        message: `${selected.paused ? "Resumed" : "Paused"} ${selected.name}`,
        actionLabel: "Undo",
        action: () => dispatch(togglePauseFacility(selected.id)),
        open: true,
        timeout: 6000,
      }),
    );
  };

  return (
    <div
      className="operatingWorkspace"
      data-context={context}
      data-compact={compact || undefined}
      data-tight={tight || undefined}
      data-mini={mini || undefined}
      ref={workspace}
    >
      <section
        className="operatingStage operatingEvidence"
        aria-label="Live grid"
        ref={anchor}
        tabIndex={-1}
      >
        <header className="operatingStageHeader">
          <div>
            <Typography variant="h6">Live grid</Typography>
            <span className="operatingStageCaption">
              Supply and demand over the day
            </span>
          </div>
          {mini && selected && (
            <div className="operatingStageInlineSelection">
              <strong>{selected.name}</strong>
              <span>
                {selectedReading}
                {storedReading}
              </span>
            </div>
          )}
          {now && health && (
            <div className="operatingStageReadings">
              <span>
                <span className="weak">Supply</span>
                <strong>{formatWatts(now.supplyW)}</strong>
              </span>
              <span>
                <span className="weak">Demand</span>
                <strong>{formatWatts(now.demandW)}</strong>
              </span>
              <span className={`operatingStageHealth ${health.state}`}>
                <span>{health.label}</span>
                <strong>{health.metric}</strong>
              </span>
            </div>
          )}
        </header>
        <div className="operatingStagePlot" ref={plot}>
          {!!game.timeline.length && (
            <LiveSupplyDemand
              game={game}
              height={height}
              compact={compact}
              mini={mini}
            />
          )}
        </div>
        {selected ? (
          <div
            className="operatingStageSelection"
            role="region"
            aria-label="Selected facility controls"
          >
            <div className="operatingStageSelectedReading">
              <strong>{selected.name}</strong>
              <span>
                {selectedReading}
                {storedReading}
              </span>
            </div>
            {!readOnly && (
              <div className="operatingStageCommands">
                <Button
                  size="small"
                  disabled={index === 0}
                  onClick={() =>
                    dispatch(
                      reprioritizeFacility({ spotInList: index, delta: -1 }),
                    )
                  }
                  aria-label={`Dispatch ${selected.name} earlier`}
                >
                  Earlier
                </Button>
                <Button
                  size="small"
                  disabled={index === game.facilities.length - 1}
                  onClick={() =>
                    dispatch(
                      reprioritizeFacility({ spotInList: index, delta: 1 }),
                    )
                  }
                  aria-label={`Dispatch ${selected.name} later`}
                >
                  Later
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={selected.yearsToBuildLeft > 0 || upgrading}
                  onClick={toggle}
                >
                  {selected.paused ? "Resume" : "Pause"}
                </Button>
              </div>
            )}
            <IconButton
              aria-label="Clear selected facility"
              onClick={() => dispatch(selectFacility(null))}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>
        ) : (
          <p className="operatingStageHint">
            Select a plant or storage to inspect its output and dispatch.
          </p>
        )}
      </section>
      <div className="operatingStageContext" hidden={context !== "insights"}>
        <InsightsContainer />
      </div>
      {context === "build" && (
        <div className="operatingStageContext operatingStageBuild">
          <BuildFacilities contextual />
        </div>
      )}
      {context === "events" && (
        <div className="operatingStageContext">
          <EventLogContainer />
        </div>
      )}
    </div>
  );
}
