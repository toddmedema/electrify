import { facilityIconSrc } from "../../helpers/FacilityIcon";
import TerritoryNetwork from "./TerritoryNetwork";
import RegionalGridMap from "./RegionalGridMap";
import MultiplayerTerritoryMap from "./MultiplayerTerritoryMap";
import TerritorialAgreements from "./TerritorialAgreements";
import PowerAgreements from "../base/PowerAgreements";
import {
  INHERITED_CONNECTIONS,
  inheritedConnection,
  utilityOwnedAt,
} from "../../helpers/PowerAgreements";
import { UtilityId } from "../../Types";
import {
  hasTerritoryNetwork,
  facilityTerritoryId,
} from "../../helpers/Territories";
import { territoryName } from "../base/TerritoryBuildDestination";
import { getTerritoryDefinition } from "../../data/Territories";
import {
  getInterfaceScale,
  subscribeInterfaceScale,
} from "../../InterfaceScale";
import * as React from "react";
import { TransitionGroup } from "react-transition-group";
import RemovalCollapse from "../base/RemovalCollapse";
import RemovableDraggable, {
  RemovableDragList,
} from "../base/RemovableDraggable";
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { ChevronDownGlyph } from "../base/Glyphs";
import {
  DragDropContext,
  DraggingStyle,
  Droppable,
  DropResult,
  DragStart,
  NotDraggingStyle,
} from "@hello-pangea/dnd";
import FacilityContextMenu, { FacilityMenuTarget } from "./FacilityContextMenu";
import { facilityGroupMoves } from "./FacilitySelection";
import { TickThrottle } from "../../helpers/RenderThrottle";
import {
  activeScenario,
  currentGenerationW,
} from "../../helpers/GameSelectors";
import { chartPalette, facilityColor } from "../../Theme";
import {
  AcquireUtilityAction,
  FacilityOperatingType,
  isStorage,
  GameType,
  RetrofitFacilityAction,
  EvidenceRequestType,
  MapWorkspaceView,
} from "../../Types";
import { AWAITING_TILE_CONNECTION } from "../../helpers/TerritoryConnections";
import { facilityPermanentlyShutdown } from "../../helpers/Financials";
import { storyOutputMultiplier } from "../../helpers/Story";
import {
  formatWattHoursOfPeak,
  formatWatts,
  formatWattsOfPeak,
  formatWattsInUnit,
  formatBuildMonths,
  getWattUnit,
  formatDays,
} from "../../helpers/Format";
import ChartSupplyDemand from "../base/ChartSupplyDemand";
import { getDispatchOrderedFuels } from "../../helpers/Energy";
import FlowBar from "../base/FlowBar";
import FacilityRowText from "../base/FacilityRowText";
import {
  constructionFraction,
  constructionStatus,
} from "../base/ConstructionProgress";
import { SIDE_LAYOUT_MIN_WIDTH } from "../../Globals";
import ExpandedFacilityDetails from "../base/ExpandedFacilityDetails";
import type { FacilityCapacityUpgradeActions } from "../base/FacilityCapacityUpgrade";
import GameCard from "../base/GameCard";
import ConceptIcon from "../base/ConceptIcon";
import { combineStoryEffects } from "../../data/WorldEvents";
import {
  COLD_DEFINITION_ID,
  facilityHazardStatus,
  FacilityHazardStatusType,
  HAIL_DEFINITION_ID,
  isUpgradingAt,
  retrofitOutputMultiplier,
  upgradeDaysLeft,
  upgradeInProgress,
  upgradeProgress,
} from "../../helpers/Hazards";
import {
  COAL_REPOWER_OPTIONS,
  coalRepowerInProgress,
} from "../../helpers/CoalRepower";
import { resilienceName } from "../base/WeatherResilienceText";
import TransmissionPanel, { TradingControls } from "./TransmissionPanel";
import { BuyingRuleType, SellingRuleType } from "../../Types";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
import { GAME_TO_REAL_YEARS, TICKS_PER_HOUR } from "../../Constants";

interface FacilityListItemProps extends FacilityCapacityUpgradeActions {
  animate?: boolean;
  in?: boolean;
  onExited?: React.ComponentProps<typeof RemovableDraggable>["onExited"];
  arriving: boolean;
  onArrivalShown?: (id: number) => void;
  facility: FacilityOperatingType;
  spotInList: number;
  game: GameType;
  selected: boolean;
  bulkSelected: boolean;
  selectionEnabled: boolean;
  showCheckboxes: boolean;
  selectionCount: number;
  onToggleSelection: (id: number, event: React.MouseEvent) => void;
  onRowClick: (id: number, event: React.MouseEvent) => void;
  onContextMenu: (id: number, event: React.MouseEvent) => void;
  storyOutputMultiplier: number;
  limitReason: string;
  hazardStatus?: FacilityHazardStatusType;
  onTogglePause: DispatchProps["onTogglePause"];
  onPause: DispatchProps["onPause"];
  onSell: DispatchProps["onSell"];
  onRetrofit?: DispatchProps["onRetrofit"];
  onCancelRetrofit?: DispatchProps["onCancelRetrofit"];
}

/**
 * A weather outage leads the row's status line, in amber, so a damaged plant reads as damaged
 * before its reduced output does. The long and short forms swap on row width like upgrade details.
 */
function hazardStatusText(status: FacilityHazardStatusType): {
  long: string;
  short: string;
  spoken: string;
} {
  const available = Math.round(status.availableFraction * 100);
  const days = status.daysLeft;
  const longParts = [
    status.label,
    `${available}% available`,
    days !== undefined ? `${formatDays(days)} to repair` : "",
  ].filter(Boolean);
  return {
    long: longParts.join(" · "),
    short: [
      { HAIL: "Hail", EXTREME_COLD: "Cold", WILDFIRE: "Fire" }[status.hazard],
      `${available}%`,
      days !== undefined ? `${days}d` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    spoken: longParts.join(", "),
  };
}

function HazardStatusLead(props: {
  status: FacilityHazardStatusType;
}): React.JSX.Element {
  const { long, short } = hazardStatusText(props.status);
  // The row's disclosure carries the spoken form in its label, so these are visual only; the
  // title spells out the abbreviated form for a pointer
  return (
    <>
      <span className="facilityHazardStatus" aria-hidden="true" title={long}>
        <span className="facilityHazardLong">{long}</span>
        <span className="facilityHazardShort">{short}</span>
      </span>
      <span className="facilityHazardSeparator" aria-hidden="true">
        {" · "}
      </span>
    </>
  );
}

// Weather hazards report themselves through the row's own status lead, so the generic story
// limit chip leaves them out rather than stating the same derate twice
function isWeatherHazardEvent(definitionId: string): boolean {
  return (
    definitionId === HAIL_DEFINITION_ID || definitionId === COLD_DEFINITION_ID
  );
}

const getDraggableStyle = (
  draggableStyle: DraggingStyle | NotDraggingStyle | undefined,
): React.CSSProperties => ({
  userSelect: "none",
  ...draggableStyle,
});

// The one-glance answer to "what is this thing doing right now", so the fleet can be read down
// the left edge without parsing any of the numbers next to it.
type FacilityActivityType =
  | "BUILDING"
  | "UPGRADING"
  | "PAUSED"
  | "IDLE"
  | "RUNNING"
  | "CHARGING"
  | "DISCHARGING";

function activityIcon(activity: FacilityActivityType, color: string) {
  const style = { color };
  switch (activity) {
    case "BUILDING":
    case "UPGRADING":
      return <ConceptIcon concept="construction" style={style} />;
    case "PAUSED":
      return <ConceptIcon concept="pause" style={style} />;
    case "IDLE":
      return <RemoveIcon style={{ color: "var(--delta-bad)" }} />;
    case "CHARGING":
      return <ArrowUpwardIcon style={style} />;
    case "DISCHARGING":
    case "RUNNING":
      return <AddIcon style={{ color: "var(--delta-good)" }} />;
    default:
      return <ConceptIcon concept="supply" style={style} />;
  }
}

// Spoken form of the same thing, since the glyph is the only place some of these states are
// reported and a screen reader can't see a lightning bolt
const ACTIVITY_LABELS: { [k in FacilityActivityType]: string } = {
  BUILDING: "under construction",
  UPGRADING: "offline for an upgrade",
  PAUSED: "paused",
  IDLE: "idle",
  RUNNING: "running",
  CHARGING: "charging",
  DISCHARGING: "discharging",
};

// Display only: the row turns its water status red below 20%, rounded to a whole percent.
// Deliberately above LOW_RESERVOIR_FRACTION
// (HydroOutlook), which marks the point where output is already being held back and drives the
// "Nearly empty." forecast lead -- the row warns before that bites.
const RESERVOIR_WARNING_FRACTION = 0.2;

function FacilityListItem(props: FacilityListItemProps): React.JSX.Element {
  const {
    facility,
    game,
    onTogglePause,
    onPause,
    selected,
    storyOutputMultiplier,
    limitReason,
    hazardStatus,
    arriving: arrivalRequested,
    onArrivalShown,
  } = props;
  // Early walkthroughs hide reordering; keep the icon in their inspection target.
  const reorderDisabled = !!(
    game.inGame &&
    activeScenario(game)?.tutorialSteps?.[game.tutorialStep]?.hideUi?.includes(
      "facilityActions",
    )
  );
  const underConstruction = facility.yearsToBuildLeft > 0;
  const waitingForGrid = facility.yearsToBuildLeft === AWAITING_TILE_CONNECTION;
  const permanentlyShutdown = facilityPermanentlyShutdown(
    facility,
    game.date.minute,
  );
  const outputW = permanentlyShutdown ? 0 : facility.currentW;
  const installing = underConstruction
    ? undefined
    : upgradeInProgress(facility);
  const upgrading = !!installing && isUpgradingAt(facility, game.date.minute);
  const project = coalRepowerInProgress(facility);
  const repowering = upgrading && !!project;
  const partialUpgrade =
    upgrading && retrofitOutputMultiplier(facility, game.date.minute) > 0;
  const offlineForWork = underConstruction || (upgrading && !partialUpgrade);
  const storage = isStorage(facility) ? facility : undefined;
  const disclosure = React.useRef<HTMLButtonElement>(null);
  const repowerProgressId = React.useId();
  const wasBuilding = React.useRef(underConstruction);
  const [arriving, setArriving] = React.useState(arrivalRequested);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (arrivalRequested) {
      setArriving(true);
      onArrivalShown?.(facility.id);
    }
  }, [arrivalRequested, onArrivalShown, facility.id]);
  React.useEffect(() => {
    if (!arriving) return;
    // Also consume the cue when reduced motion prevents animationend from firing.
    const timer = window.setTimeout(() => setArriving(false), 240);
    return () => window.clearTimeout(timer);
  }, [arriving]);
  React.useEffect(() => {
    if (wasBuilding.current && !underConstruction) {
      setReady(true);
    }
    wasBuilding.current = underConstruction;
  }, [underConstruction]);
  React.useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setReady(false), 2400);
    return () => window.clearTimeout(timer);
  }, [ready]);

  let activity: FacilityActivityType = "RUNNING";
  if (underConstruction) {
    activity = "BUILDING";
  } else if (upgrading && !repowering) {
    activity = "UPGRADING";
  } else if (facility.paused) {
    activity = "PAUSED";
  } else if (storage) {
    // Use the same dispatch reading as the flow bar. Render-to-render energy deltas
    // disappear on selection and cannot describe an already-running battery on mount.
    activity =
      facility.currentW < 0
        ? "CHARGING"
        : facility.currentW > 0
          ? "DISCHARGING"
          : "IDLE";
  } else if (facility.currentW <= 0) {
    activity = "IDLE";
  }

  const fuel = facility.fuel;
  const accentColor = facilityColor(fuel);
  const capacityFraction = storage
    ? storage.currentWh / storage.peakWh
    : fuel === "Hydro" && facility.reservoirCapacityWh
      ? (facility.reservoirWh || 0) / facility.reservoirCapacityWh
      : null;
  // Signed: storage sets a negative currentW while it charges, which used to scaleX the row
  // bar backwards off its own left edge and read as an idle battery.
  const outputFraction =
    facility.peakW > 0
      ? Math.max(-1, Math.min(1, outputW / facility.peakW))
      : 0;
  // The row's second line has to stay one line on a 360px phone, so it leads with the reading
  // and the state and leaves anything else to a trailing detail that truncates first. Rated
  // storage power and the reservoir's absolute size are both in the opened details.
  const builtFraction = upgrading
    ? upgradeProgress(installing!, game.date.minute)
    : underConstruction
      ? (constructionFraction(facility) ?? 0)
      : 1;
  const limited = storyOutputMultiplier < 1;
  const unit = getWattUnit(facility.peakW);
  // Keep small derates visible on GW plants, with the same precision for both capacities.
  const outputReading = limited ? (
    <>
      {formatWattsOfPeak(outputW, facility.peakW).split("/")[0]}/
      <s>
        {formatWattsInUnit(facility.peakW, unit, 3).replace(/[^0-9.,]/g, "")}
      </s>{" "}
      {formatWattsInUnit(facility.peakW * storyOutputMultiplier, unit, 3)}
    </>
  ) : (
    formatWattsOfPeak(outputW, facility.peakW)
  );
  const repowerPercent = Math.floor(builtFraction * 100);
  const activityLabel = waitingForGrid
    ? "waiting for grid connection"
    : repowering
      ? `construction of ${COAL_REPOWER_OPTIONS[project.upgrade].name}, ${repowerPercent}% complete`
      : partialUpgrade
        ? "installing winterization, 90% capacity available"
        : undefined;
  let reading: React.ReactNode = "";
  let detail: React.ReactNode = null;
  if (waitingForGrid) {
    reading = "Waiting for grid connection";
  } else if (underConstruction) {
    ({ reading, detail } = constructionStatus(
      builtFraction,
      facility.yearsToBuildLeft,
    ));
  } else if (upgrading) {
    const daysLeft = upgradeDaysLeft(installing!, game.date.minute);
    reading = partialUpgrade
      ? outputReading
      : `Upgrading ${Math.round(builtFraction * 100)}%`;
    detail = (
      <>
        <span className="facilityStatusLong">
          {repowering
            ? `Repowering ${repowerPercent}%`
            : partialUpgrade
              ? `Winterizing ${Math.round(builtFraction * 100)}% · 90% capacity available`
              : resilienceName(installing!.upgrade)}
          , {formatDays(daysLeft)} left
        </span>
        <span className="facilityStatusShort">
          {repowering ? `Repowering ${repowerPercent}%` : `${daysLeft}d left`}
        </span>
      </>
    );
  } else if (facility.peakWh) {
    reading = formatWattHoursOfPeak(facility.currentWh, facility.peakWh);
  } else {
    reading = outputReading;
    // A reservoir row's percentage would read as how full it is, which its gauge already shows.
    if (!(fuel === "Hydro" && facility.reservoirCapacityWh))
      reading = (
        <>
          {reading} · {Math.round(Math.abs(outputFraction) * 100)}%
        </>
      );
    if (fuel === "Hydro" && facility.reservoirCapacityWh) {
      // Last-tick water balance stays meaningful on mount and selection. Paused turbines can
      // retain ramping currentW internally, so exclude their output from the water balance.
      const generatedWh = facility.paused
        ? 0
        : (facility.currentW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
      const changeWh = Math.round(
        (facility.hydroLastInflowWh || 0) -
          (facility.hydroLastSpillWh || 0) -
          (facility.hydroLastBypassWh || 0) -
          generatedWh,
      );
      const waterStatus =
        changeWh > 0
          ? "filling"
          : changeWh < 0
            ? "draining"
            : facility.hydroLastSpillWh
              ? "spilling"
              : "";
      const low =
        Math.round(capacityFraction! * 100) < RESERVOIR_WARNING_FRACTION * 100;
      detail = waterStatus ? (
        <span className={low ? "facilityStatusLow" : undefined}>
          {waterStatus}
          {low && <span className="srOnly"> low</span>}
        </span>
      ) : null;
    }
  }
  if (facility.expansionInProgress) {
    detail = (
      <>
        {detail}
        {detail && " · "}
        Upgrading ·{" "}
        {formatBuildMonths(facility.expansionInProgress.yearsToBuildLeft)} left
      </>
    );
  }
  // Output communicates normal operation; keep explicit labels for other states.
  const status =
    offlineForWork ||
    (partialUpgrade && !repowering) ||
    activity === "RUNNING" ? (
      reading
    ) : typeof reading === "string" ? (
      `${reading} · ${ACTIVITY_LABELS[activity]}`
    ) : (
      <>
        {reading} · {ACTIVITY_LABELS[activity]}
      </>
    );

  const icon = (
    <ListItemAvatar
      className="facilityRowIcon"
      sx={
        offlineForWork
          ? { opacity: (theme) => theme.palette.action.disabledOpacity }
          : undefined
      }
    >
      <div>
        <Avatar
          className={activity === "IDLE" ? "facilityIconIdle" : ""}
          alt={facility.name}
          src={facilityIconSrc(facility)}
        />
        {capacityFraction !== null && !underConstruction && (
          <div className="capacityProgressBar" aria-hidden="true">
            <div
              className="capacityProgressBarFill"
              style={{
                transform: `scaleY(${capacityFraction})`,
                backgroundColor:
                  activity === "CHARGING" ? chartPalette().storage : undefined,
              }}
            />
          </div>
        )}
        <div
          className="facilityActivity"
          role="img"
          aria-label={`${facility.name} ${activityLabel ?? ACTIVITY_LABELS[activity]}`}
        >
          {activityIcon(activity, accentColor)}
        </div>
      </div>
    </ListItemAvatar>
  );

  return (
    <RemovableDraggable
      animate={props.animate}
      in={props.in}
      onExited={props.onExited}
      draggableId={"f" + facility.id}
      index={props.spotInList}
      isDragDisabled={reorderDisabled}
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          role="listitem"
          className={`facilityRow${selected ? " selected" : ""}${props.bulkSelected ? " bulkSelected" : ""}${snapshot.isDragging ? " dragging" : ""}`}
          onContextMenu={(event) => props.onContextMenu(facility.id, event)}
          data-facility-id={facility.id}
          data-fuel={fuel}
          data-facility={facility.name}
          style={getDraggableStyle(provided.draggableProps?.style)}
        >
          <div
            className={`facilityRowHeader${arriving ? " facilityArrival" : ""}${ready ? " facilityReady" : ""}`}
            data-storage={!!storage || undefined}
            onAnimationEnd={(event) => {
              if (event.animationName === "facilityArrival") setArriving(false);
            }}
          >
            {/* Behind the whole row, grip included, so the fill reads edge to edge. Tinted by
            fuel so the list reads as the same dispatch stack the supply-by-fuel chart draws, and
            transitioned in CSS so ramping is visible as movement */}
            {!offlineForWork && <FlowBar fraction={outputFraction} />}
            {!reorderDisabled && (
              <button
                type="button"
                {...provided.dragHandleProps}
                className="facilityDragHandle"
                aria-label={"Reorder " + facility.name}
                title="Drag to reorder"
                onClick={(event) => {
                  if (event.shiftKey || event.ctrlKey || event.metaKey)
                    props.onRowClick(facility.id, event);
                }}
              >
                <DragIndicatorIcon aria-hidden />
                {icon}
                {snapshot.isDragging &&
                  props.bulkSelected &&
                  props.selectionCount > 1 && (
                    <span className="facilityDragCount">
                      {props.selectionCount} facilities
                    </span>
                  )}
              </button>
            )}
            <button
              type="button"
              ref={disclosure}
              className="facilityDisclosure"
              aria-describedby={repowering ? repowerProgressId : undefined}
              aria-label={
                `Inspect ${facility.name}` +
                (hasTerritoryNetwork(game)
                  ? `, ${territoryName(facilityTerritoryId(facility))}`
                  : "") +
                (hazardStatus && !underConstruction
                  ? `, ${hazardStatusText(hazardStatus).spoken}`
                  : "") +
                (storage || waitingForGrid ? `, ${status}` : "") +
                (facility.expansionInProgress
                  ? `, capacity upgrading, ${formatBuildMonths(facility.expansionInProgress.yearsToBuildLeft, "long")} left`
                  : "")
              }
              aria-expanded={selected}
              aria-pressed={props.bulkSelected}
              onClick={(event) => props.onRowClick(facility.id, event)}
            >
              <ListItem className="facility" component="span">
                {reorderDisabled && icon}
                <FacilityRowText
                  name={
                    <>
                      <span className="facilityName">{facility.name}</span>
                      {hasTerritoryNetwork(game) && (
                        <span className="facilityTerritoryLabel">
                          {territoryName(facilityTerritoryId(facility))}
                        </span>
                      )}
                      {ready && (
                        <span className="facilityReadyLabel">Ready</span>
                      )}
                      {storyOutputMultiplier < 1 && (
                        <Tooltip
                          title={limitReason}
                          placement="top"
                          describeChild
                        >
                          <Chip
                            className="storyDerateBadge"
                            color="warning"
                            size="small"
                            label={`${Math.round(storyOutputMultiplier * 100)}% limit`}
                            aria-label={`Temporarily limited to ${Math.round(storyOutputMultiplier * 100)}% of rated output`}
                          />
                        </Tooltip>
                      )}
                    </>
                  }
                  lead={
                    hazardStatus && !underConstruction ? (
                      <HazardStatusLead status={hazardStatus} />
                    ) : undefined
                  }
                  status={status}
                  detail={detail}
                  progress={
                    underConstruction || upgrading
                      ? { builtFraction, paused: game.speed === "PAUSED" }
                      : undefined
                  }
                />
                {props.selectionEnabled && (
                  <span className="facilitySelectionSlot" aria-hidden>
                    {props.bulkSelected && !props.showCheckboxes && (
                      <CheckIcon fontSize="small" />
                    )}
                  </span>
                )}
                <ChevronDownGlyph className="facilityChevron" aria-hidden />
              </ListItem>
            </button>
            {repowering && (
              <span id={repowerProgressId} className="srOnly">
                {activityLabel}
              </span>
            )}
            {props.showCheckboxes && (
              <Checkbox
                className="facilitySelectionCheckbox"
                size="small"
                checked={props.bulkSelected}
                onClick={(event) => props.onToggleSelection(facility.id, event)}
                slotProps={{
                  input: {
                    "aria-label": `Select ${facility.name}`,
                  },
                }}
              />
            )}
          </div>
          {selected && (
            <ExpandedFacilityDetails
              facility={facility}
              game={game}
              onSell={props.onSell}
              onPause={onPause}
              onTogglePause={onTogglePause}
              onRetrofit={props.onRetrofit}
              onExpand={props.onExpand}
              onCancelExpansion={props.onCancelExpansion}
              onCancelRetrofit={
                props.onCancelRetrofit &&
                ((id) => {
                  props.onCancelRetrofit?.(id);
                  if (repowering) disclosure.current?.focus();
                })
              }
            />
          )}
        </div>
      )}
    </RemovableDraggable>
  );
}

// Always drawn rather than behind a phone-only disclosure: on a phone the chart scrolls away
// with the rest of the pane (see .facilitiesBody), the way Insights does
function FacilitySupplyChart({
  game,
  anchor,
}: {
  game: GameType;
  anchor: React.RefObject<HTMLDivElement>;
}) {
  const fuelOrder = getDispatchOrderedFuels(game.facilities);
  const height = useFleetChartHeight(anchor);
  // A portrait tablet's sheet starts where this block ends.
  React.useLayoutEffect(() => {
    const element = anchor.current;
    const stage = element?.closest(".gameStage");
    if (!element || !stage) return;
    const publish = () => {
      const bottom =
        element.getBoundingClientRect().bottom -
        stage.getBoundingClientRect().top;
      document.documentElement.style.setProperty(
        "--game-chart-block",
        `${Math.round(bottom)}px`,
      );
    };
    publish();
    // The chart mounts after this block, so its height arrives a frame later.
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchor]);
  return (
    <div
      ref={anchor}
      tabIndex={-1}
      className="operatingEvidence facilitySupplyChart"
      aria-label="Supply and demand"
    >
      <ChartSupplyDemand
        height={height}
        exactHeight
        timeline={game.timeline}
        exchangeLabel={hasTerritoryNetwork(game) ? "External power" : undefined}
        fuelOrder={fuelOrder}
        currentMinute={game.date.minute}
        speed={game.speed}
        location={game.location}
        legend
        startingYear={game.startingYear}
      />
    </div>
  );
}

/** The fleet chart grows with its pane; narrow panes keep it 15% shorter. */
export function fleetChartHeight(width: number, height: number): number {
  const fit = (min: number, share: number, max: number) =>
    Math.round(Math.max(min, Math.min(max, height * share)));
  if (width >= SIDE_LAYOUT_MIN_WIDTH) return fit(180, 0.25, 260);
  const compactHeight =
    width < 600
      ? fit(200, 0.38, 420)
      : width > height
        ? fit(180, 0.3, 260)
        : fit(180, 0.28, 340);
  return Math.round(compactHeight * 0.85);
}

/**
 * Keep chart height synchronized with its rendered pane and interface scale.
 * Couch panes reserve 20% of the usual plot height for the rest of each company's fleet.
 */
function useFleetChartHeight(anchor: React.RefObject<HTMLDivElement>): number {
  const measure = React.useCallback(() => {
    const pane = anchor.current?.closest(".facilitiesBody");
    const width =
      anchor.current?.getBoundingClientRect().width || window.innerWidth;
    const availableHeight =
      pane?.getBoundingClientRect().height || window.innerHeight;
    const scale = getInterfaceScale();
    const height = Math.round(
      fleetChartHeight(width / scale, availableHeight / scale) * scale,
    );
    // Split-screen keeps the daily plot 20% shorter to leave room for the fleet.
    return window.electrifyCouch ? Math.round(height * 0.8) : height;
  }, [anchor]);
  const [height, setHeight] = React.useState(measure);
  React.useLayoutEffect(() => {
    const resize = () => setHeight(measure());
    resize();
    const observer = new ResizeObserver(resize);
    const pane = anchor.current?.closest(".facilitiesBody");
    if (pane) observer.observe(pane);
    window.addEventListener("resize", resize);
    const stop = subscribeInterfaceScale(resize);
    return () => {
      window.removeEventListener("resize", resize);
      observer.disconnect();
      stop();
    };
  }, [anchor, measure]);
  return height;
}

export interface StateProps {
  arrivingFacilityId?: number;
  evidenceRequest?: EvidenceRequestType;
  facilityDragActive?: boolean;
  game: GameType;
  // The row the player has open, from the UI slice rather than this component's own state:
  // Insights reads it too, and building a facility unmounts this pane
  selectedFacilityId: number | null;
}

export interface DispatchProps extends FacilityCapacityUpgradeActions {
  onArrivalShown?: (id: number) => void;
  onEvidenceReady?: (
    request: EvidenceRequestType,
    element: HTMLElement | null,
  ) => void;
  onSell: (id: FacilityOperatingType["id"]) => void;
  onTogglePause: (id: FacilityOperatingType["id"]) => void;
  onPause: (id: FacilityOperatingType["id"], name: string) => void;
  onReprioritize: (spotInList: number, delta: number) => void;
  onRetrofit?: (payload: RetrofitFacilityAction) => void;
  onCancelRetrofit?: (id: FacilityOperatingType["id"]) => void;
  onFacilityDragStart: (speed: GameType["speed"]) => void;
  onFacilityDragEnd: (
    sourceIndex: number,
    destinationIndex: number | null,
    resumeSpeed: GameType["speed"],
    intertie?: boolean,
  ) => void;
  onSelect: (id: FacilityOperatingType["id"] | null) => void;
  onStorageBuild: () => void;
  onTransmissionBuild: (
    corridorId: string,
    financed: boolean,
    tier?: number,
  ) => void;
  onTransmissionCancel?: (id: number) => void;
  onTransmissionPause?: (id: number, name: string, paused: boolean) => void;
  onTransmissionUpgrade: (corridorId: string, financed: boolean) => void;
  onUtilityAcquire?: (
    payload: AcquireUtilityAction,
  ) => boolean | Promise<boolean>;
  onBuyingRule: (rule: BuyingRuleType) => void;
  onSellingRule: (rule: SellingRuleType) => void;
}

export interface Props extends StateProps, DispatchProps {
  paneId?: string;
  territoryView?: MapWorkspaceView;
  agreementPeer?: string;
  onTerritoryView?: (view: MapWorkspaceView, peer?: string) => void;
}

interface SelectionState {
  ids: number[];
  anchor: number | null;
  menu: FacilityMenuTarget | null;
  groupDragging: boolean;
  selectionMode: boolean;
  modifierHeld: boolean;
}

export default class Facilities extends React.Component<Props, SelectionState> {
  public state: SelectionState = {
    ids: [],
    anchor: null,
    menu: null,
    groupDragging: false,
    selectionMode: false,
    modifierHeld: false,
  };
  private draggedIds: number[] = [];
  private removedFacilityIds = new Set<number>();

  private sellFacility = (id: number) => {
    this.removedFacilityIds.add(id);
    this.props.onSell(id);
  };

  private animateRemovedFacility = (
    child: React.ReactElement<FacilityListItemProps>,
  ) =>
    React.cloneElement(child, {
      animate: this.removedFacilityIds.has(child.props.facility.id),
    });
  private removingLastIntertie = false;

  private cancelFleetIntertie = (id: number) => {
    const lines = this.props.game.transmission?.lines;
    this.removingLastIntertie = lines?.length === 1 && lines[0].id === id;
    this.props.onTransmissionCancel?.(id);
  };

  private selectionFocus: HTMLButtonElement | null = null;
  private previewFocus: HTMLButtonElement | null = null;
  private menuFocus: HTMLButtonElement | null = null;

  // One query list tracks whether this device supports mouse selection.
  private finePointer: MediaQueryList | null = null;

  private mouseEnabled = () =>
    (this.finePointer ??= window.matchMedia("(any-pointer: fine)")).matches &&
    !(
      this.props.game.inGame &&
      activeScenario(this.props.game)?.tutorialSteps?.[
        this.props.game.tutorialStep
      ]?.hideUi?.includes("facilityActions")
    );

  private onRowClick = (
    id: number,
    event: React.MouseEvent,
    toggle = false,
  ) => {
    if (!this.mouseEnabled()) {
      this.props.onSelect(this.props.selectedFacilityId === id ? null : id);
      return;
    }
    const ids = this.props.game.facilities.map((f) => f.id);
    const current = this.state.ids.filter((selected) => ids.includes(selected));
    if (event.shiftKey) {
      const candidate = this.state.anchor ?? this.props.selectedFacilityId;
      const anchor =
        candidate !== null && ids.includes(candidate) ? candidate : id;
      const from = ids.indexOf(anchor);
      const to = ids.indexOf(id);
      const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      this.setState({
        ids:
          event.ctrlKey || event.metaKey
            ? [...new Set([...current, ...range])]
            : range,
        anchor,
        selectionMode: true,
      });
      this.props.onSelect(null);
    } else if (toggle || event.ctrlKey || event.metaKey) {
      this.setState({
        ids: current.includes(id)
          ? current.filter((selected) => selected !== id)
          : [...current, id],
        anchor: id,
        selectionMode: true,
      });
      if (!toggle) this.props.onSelect(null);
    } else {
      if (!this.selectionModeActive()) this.setState({ ids: [id], anchor: id });
      this.props.onSelect(this.props.selectedFacilityId === id ? null : id);
    }
  };

  private onToggleSelection = (id: number, event: React.MouseEvent) =>
    this.onRowClick(id, event, true);

  private onContextMenu = (id: number, event: React.MouseEvent) => {
    if (!this.mouseEnabled()) return;
    event.preventDefault();
    event.stopPropagation();
    // macOS emits contextmenu with button 0 for Ctrl-click, with no click afterward.
    if (event.ctrlKey && event.button === 0) {
      this.onRowClick(id, event);
      return;
    }
    const button = event.currentTarget.querySelector<HTMLButtonElement>(
      ".facilityDisclosure",
    );
    this.menuFocus = button;
    button?.focus();
    const bounds = button?.getBoundingClientRect();
    const ids = this.state.ids.includes(id) ? this.state.ids : [id];
    this.setState({
      ids,
      modifierHeld: false,
      anchor: this.state.ids.includes(id) ? this.state.anchor : id,
      menu: {
        ids,
        top: event.clientY || bounds?.top || 0,
        left: event.clientX || bounds?.left || 0,
      },
    });
  };

  private closeMenu = () => this.setState({ menu: null });

  private openActions = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    this.menuFocus =
      this.scrollBody?.querySelector<HTMLButtonElement>(
        ".bulkSelected .facilityDisclosure",
      ) ?? null;
    this.setState({
      modifierHeld: false,
      menu: {
        ids: this.props.game.facilities
          .filter((facility) => this.state.ids.includes(facility.id))
          .map((facility) => facility.id),
        top: bounds.bottom,
        left: bounds.left,
      },
    });
  };

  private liveSelectionCount = () =>
    this.props.game.facilities.filter((facility) =>
      this.state.ids.includes(facility.id),
    ).length;

  // Empty checkbox selections remain editable until explicitly cleared. Stale IDs from
  // departed facilities must still leave Escape to the active screen.
  private selectionModeActive = () =>
    this.state.selectionMode &&
    (!this.state.ids.length || this.liveSelectionCount() > 0);

  private modalOpen = () =>
    !!document.querySelector(
      '.MuiModal-root:not(.MuiModal-hidden), [data-manual-help="true"], [data-scenario-choice="true"], [data-data-center-guide="true"]',
    );

  private updateModifierPreview = (event: KeyboardEvent) => {
    const target = event.target;
    const editing =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest(
          'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]',
        ));
    const modifierHeld =
      (event.shiftKey || event.ctrlKey || event.metaKey) &&
      event.key !== "Escape" &&
      this.mouseEnabled() &&
      !!this.scrollBody &&
      !this.scrollBody.closest('[inert], [hidden], [aria-hidden="true"]') &&
      !editing &&
      !this.modalOpen();
    if (modifierHeld !== this.state.modifierHeld) {
      const focus = !modifierHeld ? this.focusedPreviewDisclosure() : null;
      this.setState({ modifierHeld }, () => {
        if (!this.selectionModeActive() && !this.modalOpen()) focus?.focus();
      });
    }
  };

  private focusedPreviewDisclosure = () =>
    document.activeElement
      ?.closest(".facilitySelectionCheckbox")
      ?.closest(".facilityRowHeader")
      ?.querySelector<HTMLButtonElement>(".facilityDisclosure") ?? null;

  private resetModifierPreview = () => {
    if (this.state.modifierHeld) {
      if (!this.selectionModeActive())
        this.previewFocus = this.focusedPreviewDisclosure();
      this.setState({ modifierHeld: false });
    }
  };

  private restorePreviewFocus = () => {
    if (
      document.activeElement === document.body &&
      this.previewFocus?.isConnected &&
      !this.previewFocus.closest('[inert], [hidden], [aria-hidden="true"]') &&
      !this.modalOpen()
    )
      this.previewFocus.focus();
    this.previewFocus = null;
  };

  private onGlobalSelectionKeyDown = (event: KeyboardEvent) => {
    this.updateModifierPreview(event);
    this.onSelectionKeyDown(event, true);
  };

  private onSelectionKeyDown = (
    event: KeyboardEvent | React.KeyboardEvent,
    multiOnly = false,
  ) => {
    if (
      event.key === "Escape" &&
      !event.defaultPrevented &&
      !this.dragging &&
      !this.scrollBody?.closest('[inert], [data-map-window-front="false"]') &&
      (this.liveSelectionCount() > (multiOnly ? 1 : 0) ||
        this.selectionModeActive())
    ) {
      const modal = this.modalOpen();
      this.clearSelection();
      // A modal also owns Escape: let it dismiss normally as the group clears behind it.
      if (!modal) event.preventDefault();
    }
  };

  private clearSelection = () => {
    const active = document.activeElement;
    const focus =
      active
        ?.closest(".facilityRow")
        ?.querySelector<HTMLButtonElement>(".facilityDisclosure") ??
      (this.state.menu ? this.menuFocus : null) ??
      (active?.closest(".facilitySelectionBar")
        ? this.scrollBody?.querySelector<HTMLButtonElement>(
            ".facilityDisclosure",
          )
        : null);
    const menuOpen = !!this.state.menu;
    // The menu's focus trap must finish exiting before a removed toolbar trigger can be
    // replaced with a row target. Otherwise it immediately pulls focus back into the menu.
    if (menuOpen) this.selectionFocus = focus ?? null;
    this.setState(
      {
        ids: [],
        anchor: null,
        menu: null,
        selectionMode: false,
        modifierHeld: false,
      },
      () => {
        if (!menuOpen) focus?.focus();
      },
    );
    this.props.onSelect(null);
  };

  private restoreSelectionFocus = () => {
    if (this.selectionFocus?.isConnected) this.selectionFocus.focus();
    this.selectionFocus = null;
  };
  constructor(props: Props) {
    super(props);
    this.onBeforeDragStart = this.onBeforeDragStart.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  private throttle = new TickThrottle();
  private scrollBody: HTMLDivElement | null = null;

  // Native wheel movement can be abandoned while the live fleet repaints. Apply its delta
  // directly to the current scroll region so ticking never interrupts the gesture.
  private onWheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented ||
      !event.cancelable ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !event.deltaY
    )
      return;
    let node = event.target instanceof Element ? event.target : null;
    while (node) {
      if (
        node instanceof HTMLElement &&
        /(auto|scroll)/.test(getComputedStyle(node).overflowY)
      ) {
        const maximum = node.scrollHeight - node.clientHeight;
        if (maximum > 0) {
          const lineHeight =
            parseFloat(getComputedStyle(node).lineHeight) || 16;
          const unit =
            event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? lineHeight
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? node.clientHeight
                : 1;
          const next = Math.max(
            0,
            Math.min(maximum, node.scrollTop + event.deltaY * unit),
          );
          if (next !== node.scrollTop) {
            event.preventDefault();
            node.scrollTop = next;
          }
          // Leave unconsumed gestures to the browser, including scroll chaining at an edge.
          return;
        }
      }
      node = node.parentElement;
    }
  };

  private setScrollBody = (node: HTMLDivElement | null) => {
    this.scrollBody?.removeEventListener("wheel", this.onWheel, true);
    this.scrollBody = node;
    // React's passive wheel listener cannot cancel the native delta after we consume it.
    node?.addEventListener("wheel", this.onWheel, {
      capture: true,
      passive: false,
    });
  };

  // The drag library already animates every row while a reorder is active. Letting the 10ms
  // FAST clock replace the whole list underneath it adds a second stream of layout work and can
  // make the pointer fall seconds behind. The drag callbacks briefly suspend that clock too;
  // this guard keeps an already-queued tick from replacing the rows before it stops.
  private dragging = false;
  private speedBeforeDrag: GameType["speed"] = "PAUSED";

  // Keep 1x presentation unchanged, but cap FAST's 100 simulation ticks/sec to 25 visual
  // refreshes/sec. Intermediate simulation ticks still run; the pane simply presents the newest.
  public shouldComponentUpdate(
    nextProps: Props,
    nextState: Readonly<SelectionState>,
  ) {
    if (nextState !== this.state) return true;
    if (this.dragging) {
      return false;
    }
    // Opening a row is something the player just did, not something the clock did, so it
    // goes through whatever the throttle is up to - otherwise the row waits for the next
    // unskipped frame, and at FAST that reads as a click that missed
    if (
      nextProps.game.speed !== this.props.game.speed ||
      nextProps.evidenceRequest !== this.props.evidenceRequest ||
      nextProps.territoryView !== this.props.territoryView ||
      nextProps.agreementPeer !== this.props.agreementPeer ||
      nextProps.game.multiplayer?.territorial?.claims.length !==
        this.props.game.multiplayer?.territorial?.claims.length ||
      nextProps.arrivingFacilityId !== this.props.arrivingFacilityId ||
      nextProps.facilityDragActive !== this.props.facilityDragActive ||
      (nextProps.game.speed !== "FAST" && nextProps.game.speed !== "ULTRA") ||
      nextProps.selectedFacilityId !== this.props.selectedFacilityId ||
      nextProps.game.facilities.map((facility) => facility.id).join("|") !==
        this.props.game.facilities.map((facility) => facility.id).join("|")
    ) {
      return true;
    }
    return this.throttle.due(nextProps.game.date.minute, 4);
  }

  public componentDidUpdate(previous: Props) {
    if (
      this.props.selectedFacilityId !== previous.selectedFacilityId &&
      this.props.selectedFacilityId !== null &&
      (this.props.territoryView === "FACILITIES" ||
        (this.props.territoryView === undefined &&
          (hasTerritoryNetwork(this.props.game) ||
            !!this.props.game.multiplayer?.territorial)))
    )
      this.props.onTerritoryView?.("FLEET");
    this.resolveEvidence();
    this.throttle.rendered(this.props.game.date.minute);
  }

  public componentDidMount() {
    this.resolveEvidence();
    document.addEventListener("keydown", this.onGlobalSelectionKeyDown, true);
    document.addEventListener("keyup", this.updateModifierPreview, true);
    window.addEventListener("blur", this.resetModifierPreview);
    window.addEventListener("focus", this.restorePreviewFocus);
  }

  public componentWillUnmount() {
    document.removeEventListener(
      "keydown",
      this.onGlobalSelectionKeyDown,
      true,
    );
    document.removeEventListener("keyup", this.updateModifierPreview, true);
    window.removeEventListener("blur", this.resetModifierPreview);
    window.removeEventListener("focus", this.restorePreviewFocus);
  }

  private evidenceAnchor = React.createRef<HTMLDivElement>();
  private intertiesAnchor = React.createRef<HTMLElement>();

  private resolveEvidence() {
    const request = this.props.evidenceRequest;
    if (!request || this.dragging || this.props.facilityDragActive) return;
    if (
      this.props.territoryView
        ? this.props.territoryView !== "FLEET"
        : hasTerritoryNetwork(this.props.game) ||
          !!this.props.game.multiplayer?.territorial
    )
      return;
    if (request.target === "interties") {
      this.props.onEvidenceReady?.(request, this.intertiesAnchor.current);
      return;
    }
    if (
      request.target !== "supply-demand" &&
      !(
        typeof request.target === "object" &&
        request.target.card === "FACILITIES" &&
        request.target.view !== "BUILD_GENERATORS"
      )
    )
      return;
    this.props.onEvidenceReady?.(request, this.evidenceAnchor.current);
  }

  public onBeforeDragStart(start?: DragStart) {
    const id = start?.draggableId.startsWith("f")
      ? Number(start.draggableId.slice(1))
      : undefined;
    this.draggedIds =
      id !== undefined && this.mouseEnabled() && this.state.ids.includes(id)
        ? [...this.state.ids]
        : [];
    this.setState({ groupDragging: this.draggedIds.length > 1 });
    this.dragging = true;
    this.speedBeforeDrag = this.props.game.speed;
    this.props.onFacilityDragStart(this.speedBeforeDrag);
  }

  public onDragEnd(result: DropResult) {
    this.dragging = false;
    this.setState({ groupDragging: false });
    if (
      result.reason === "CANCEL" &&
      (this.liveSelectionCount() > 1 || this.selectionModeActive())
    )
      this.clearSelection();
    if (result.source.droppableId === "interties") {
      this.props.onFacilityDragEnd(
        result.source.index,
        result.destination?.index ?? null,
        this.speedBeforeDrag,
        true,
      );
      return;
    }
    const bulk = this.draggedIds.length > 1;
    if (bulk && result.destination) {
      for (const move of facilityGroupMoves(
        this.props.game.facilities.map((f) => f.id),
        this.draggedIds,
        result.source.index,
        result.destination.index,
      )) {
        this.props.onReprioritize(move.spotInList, move.delta);
      }
    }
    this.draggedIds = [];
    this.props.onFacilityDragEnd(
      result.source.index,
      bulk ? null : (result.destination?.index ?? null),
      this.speedBeforeDrag,
    );
  }

  public render() {
    const {
      game,
      onTogglePause,
      onPause,
      onTransmissionBuild,
      onTransmissionUpgrade,
      onBuyingRule,
      onSellingRule,
      selectedFacilityId,
    } = this.props;
    const selection = game.facilities.filter((f) =>
      this.state.ids.includes(f.id),
    );
    const selectionEnabled = this.mouseEnabled();
    const selectionMode = this.selectionModeActive();
    const showCheckboxes =
      selectionEnabled && (this.state.modifierHeld || selectionMode);
    const facilitiesCount = game.facilities.length;
    const territoryNetwork = hasTerritoryNetwork(game);
    const territorial = !!game.multiplayer?.territorial;
    const territoryView =
      this.props.territoryView ??
      (territorial || territoryNetwork ? "FACILITIES" : "FLEET");
    const showFleet = territoryView === "FLEET";
    const facilityActions = {
      onSell: this.sellFacility,
      onPause,
      onTogglePause,
      onRetrofit: this.props.onRetrofit,
      onExpand: this.props.onExpand,
      onCancelExpansion: this.props.onCancelExpansion,
      onCancelRetrofit: this.props.onCancelRetrofit,
    };
    const intertiesAvailable =
      !territorial &&
      !!(
        game.transmission &&
        (game.multiplayer || corridorsForLocation(game.location).length)
      );
    const activeStoryEvents = game.worldEvents.active.filter(
      (event) =>
        game.date.minute >= event.startsMinute &&
        game.date.minute < event.endsMinute &&
        !isWeatherHazardEvent(event.definitionId),
    );
    const storyEffects = combineStoryEffects(activeStoryEvents);

    return (
      <GameCard
        className={showFleet ? "facilities" : undefined}
        id={this.props.paneId ?? "facilitiesPane"}
      >
        <>
          {territorial && territoryView === "FACILITIES" && (
            <div className="territoryWorkspace">
              <MultiplayerTerritoryMap
                game={game}
                onAgreements={(peer) =>
                  this.props.onTerritoryView?.("AGREEMENTS", peer)
                }
                facilityActions={facilityActions}
              />
            </div>
          )}
          {territorial && territoryView === "AGREEMENTS" && (
            <div className="scrollable territoryWorkspace">
              <TerritorialAgreements
                game={game}
                selectedPeer={this.props.agreementPeer}
                onBuyingRule={onBuyingRule}
                onSellingRule={onSellingRule}
              />
            </div>
          )}
          {!territorial && !showFleet && (
            <div className="scrollable territoryWorkspace">
              {territoryView === "FACILITIES" ? (
                territoryNetwork ? (
                  <TerritoryNetwork
                    game={game}
                    onBuild={onTransmissionBuild}
                    onUpgrade={onTransmissionUpgrade}
                    onAcquire={this.props.onUtilityAcquire}
                    onCancel={this.props.onTransmissionCancel}
                    onPause={this.props.onTransmissionPause}
                    onBuyingRule={onBuyingRule}
                    onSellingRule={onSellingRule}
                    facilityActions={facilityActions}
                  />
                ) : (
                  <RegionalGridMap
                    game={game}
                    facilityActions={facilityActions}
                  />
                )
              ) : (
                <div className="territoryAgreements">
                  {!territoryNetwork &&
                    (intertiesAvailable ? (
                      <section>
                        <TradingControls
                          game={game}
                          onBuyingRule={onBuyingRule}
                          onSellingRule={onSellingRule}
                        />
                        <Typography variant="body2">
                          Open Fleet to manage existing interties or choose
                          Interties in Build to add a connection.
                        </Typography>
                      </section>
                    ) : (
                      <Typography variant="body2">
                        Interties are unavailable for this grid.
                      </Typography>
                    ))}
                  {territoryNetwork && game.multiplayer && (
                    <section>
                      <Typography component="h3" variant="subtitle1">
                        Co-op power sharing
                      </Typography>
                      <TradingControls
                        game={game}
                        onBuyingRule={onBuyingRule}
                        onSellingRule={onSellingRule}
                      />
                    </section>
                  )}
                  {territoryNetwork &&
                    (Object.keys(INHERITED_CONNECTIONS) as UtilityId[])
                      .filter((id) =>
                        utilityOwnedAt(game, id, game.date.minute),
                      )
                      .map((id, index, portfolio) => (
                        <section key={id} className="powerAgreementPortfolio">
                          {portfolio.length > 1 && (
                            <Typography component="h3" variant="subtitle2">
                              {getTerritoryDefinition(id)?.name}
                            </Typography>
                          )}
                          <PowerAgreements
                            game={game}
                            line={inheritedConnection(id, index + 1)}
                          />
                        </section>
                      ))}
                </div>
              )}
            </div>
          )}
          {showFleet && (
            <div className="scrollable facilitiesBody" ref={this.setScrollBody}>
              <FacilitySupplyChart game={game} anchor={this.evidenceAnchor} />
              {/* The scroller holds section labels and the intertie fleet as well as rows, so the
              lists are the drag-and-drop containers inside it rather than the scroller itself. */}
              <List
                dense
                component="div"
                className="scrollable unifiedFacilitiesList"
                data-group-dragging={this.state.groupDragging || undefined}
                onKeyDown={this.onSelectionKeyDown}
              >
                <Typography
                  component="div"
                  id="dispatch-order"
                  className={`facilitySectionLabel facilityDispatchHeader${selectionMode || selection.length > 1 ? " facilityDispatchSelecting" : ""}`}
                  variant="overline"
                >
                  <span className="facilitySectionTitle">Plants & storage</span>
                  {selectionEnabled &&
                  (selectionMode || selection.length > 1) ? (
                    <div className="facilitySelectionBar">
                      <span role="status" aria-label="Facility selection">
                        {selection.length}{" "}
                        {selection.length === 1 ? "facility" : "facilities"}{" "}
                        selected
                      </span>
                      <div className="facilitySelectionActions">
                        <Button
                          size="small"
                          endIcon={<ChevronDownGlyph />}
                          aria-haspopup="menu"
                          aria-expanded={!!this.state.menu}
                          disabled={!selection.length}
                          onClick={this.openActions}
                        >
                          Actions
                        </Button>
                        <Button
                          size="small"
                          aria-label="Clear selection"
                          onClick={this.clearSelection}
                        >
                          Clear
                          <span className="facilityClearFullLabel">
                            selection
                          </span>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <span className="facilitySectionFlow">
                      {"Generating " + formatWatts(currentGenerationW(game))}
                    </span>
                  )}
                </Typography>
                <DragDropContext
                  onBeforeDragStart={this.onBeforeDragStart}
                  onDragEnd={this.onDragEnd}
                >
                  <Droppable droppableId="droppable">
                    {(provided) => (
                      <RemovableDragList
                        provided={provided}
                        label="Plants and storage"
                        childFactory={this.animateRemovedFacility}
                      >
                        {game.facilities.map(
                          (g: FacilityOperatingType, i: number) => (
                            <FacilityListItem
                              arriving={this.props.arrivingFacilityId === g.id}
                              onArrivalShown={this.props.onArrivalShown}
                              facility={g}
                              game={game}
                              key={g.id}
                              onSell={this.sellFacility}
                              onExited={() => {
                                this.removedFacilityIds.delete(g.id);
                              }}
                              onTogglePause={onTogglePause}
                              onPause={onPause}
                              onRetrofit={this.props.onRetrofit}
                              onExpand={this.props.onExpand}
                              onCancelExpansion={this.props.onCancelExpansion}
                              onCancelRetrofit={this.props.onCancelRetrofit}
                              onRowClick={this.onRowClick}
                              onContextMenu={this.onContextMenu}
                              bulkSelected={selection.some(
                                (f) => f.id === g.id,
                              )}
                              selectionEnabled={selectionEnabled}
                              showCheckboxes={showCheckboxes}
                              onToggleSelection={this.onToggleSelection}
                              selectionCount={selection.length}
                              selected={selectedFacilityId === g.id}
                              storyOutputMultiplier={storyOutputMultiplier(
                                g,
                                storyEffects,
                                game.date.minute,
                              )}
                              limitReason={(() => {
                                const reasons = activeStoryEvents
                                  .filter(
                                    (event) =>
                                      storyOutputMultiplier(
                                        g,
                                        event.effects,
                                        game.date.minute,
                                      ) < 1,
                                  )
                                  .map((event) => event.title || event.message)
                                  .filter(Boolean);
                                return reasons.length
                                  ? `Limited due to ${Array.from(new Set(reasons)).join("; ")}`
                                  : "Limited by an active event";
                              })()}
                              hazardStatus={facilityHazardStatus(game, g)}
                              spotInList={i}
                            />
                          ),
                        )}
                      </RemovableDragList>
                    )}
                  </Droppable>
                </DragDropContext>
                {facilitiesCount < 2 && (
                  <Typography
                    color="textSecondary"
                    variant="body2"
                    style={{ textAlign: "center", marginTop: "12px" }}
                  >
                    Choose Build to add a generator or storage.
                  </Typography>
                )}
                <TransitionGroup
                  component={null}
                  childFactory={(
                    child: React.ReactElement<
                      React.ComponentProps<typeof RemovalCollapse>
                    >,
                  ) =>
                    React.cloneElement(child, {
                      animate: this.removingLastIntertie,
                    })
                  }
                >
                  {!territoryNetwork &&
                    intertiesAvailable &&
                    !!game.transmission?.lines.length && (
                      <RemovalCollapse
                        key="interties"
                        onExited={() => {
                          this.removingLastIntertie = false;
                        }}
                      >
                        <section
                          aria-label="Intertie management"
                          ref={this.intertiesAnchor}
                          tabIndex={-1}
                        >
                          <TransmissionPanel
                            game={game}
                            onBuild={onTransmissionBuild}
                            onUpgrade={onTransmissionUpgrade}
                            onAcquire={this.props.onUtilityAcquire}
                            onCancel={
                              this.props.onTransmissionCancel &&
                              this.cancelFleetIntertie
                            }
                            onPause={this.props.onTransmissionPause}
                            onBuyingRule={onBuyingRule}
                            onSellingRule={onSellingRule}
                            onBeforeDragStart={this.onBeforeDragStart}
                            onDragEnd={this.onDragEnd}
                          />
                        </section>
                      </RemovalCollapse>
                    )}
                </TransitionGroup>
              </List>
            </div>
          )}
          <FacilityContextMenu
            game={game}
            target={this.state.menu}
            onClose={this.closeMenu}
            onMenuExited={this.restoreSelectionFocus}
            onSell={this.sellFacility}
            onPause={onPause}
            onTogglePause={onTogglePause}
            onRetrofit={this.props.onRetrofit}
            onCancelRetrofit={this.props.onCancelRetrofit}
          />
        </>
      </GameCard>
    );
  }
}
