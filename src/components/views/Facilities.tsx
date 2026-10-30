import * as React from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  DialogContentText,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CancelIcon from "@mui/icons-material/Cancel";
import ConfirmDialog from "../base/ConfirmDialog";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RemoveIcon from "@mui/icons-material/Remove";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { ChevronDownGlyph } from "../base/Glyphs";
import {
  DragDropContext,
  Draggable,
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
import { chartPalette, facilityColor, withAlpha } from "../../Theme";
import {
  FacilityOperatingType,
  isStorage,
  GameType,
  RetrofitFacilityAction,
  EvidenceRequestType,
} from "../../Types";
import { facilityCashBack } from "../../helpers/Financials";
import { storyOutputMultiplier } from "../../helpers/Story";
import {
  formatMoneyConcise,
  formatWattHoursOfPeak,
  formatWatts,
  formatWattsOfPeak,
  formatFacilitySize,
} from "../../helpers/Format";
import ChartSupplyDemand from "../base/ChartSupplyDemand";
import { getDispatchOrderedFuels } from "../../helpers/Energy";
import FlowBar from "../base/FlowBar";
import FacilityDetails from "../base/FacilityDetails";
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
import { dayCount, resilienceName } from "../base/WeatherResilienceText";
import TransmissionPanel from "./TransmissionPanel";
import { TradingPolicyType } from "../../Types";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
import { GAME_TO_REAL_YEARS, TICKS_PER_HOUR } from "../../Constants";

interface FacilityListItemProps {
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
    days !== undefined ? `${dayCount(days)} to repair` : "",
  ].filter(Boolean);
  return {
    long: longParts.join(" · "),
    short: [
      status.hazard === "HAIL" ? "Hail" : "Cold",
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

function facilityIconName(facility: FacilityOperatingType): string {
  // Authored scenarios may give a plant a narrative label, but uranium facilities still use
  // the standard Nuclear artwork instead of looking for an image named after that label.
  return "fuel" in facility && facility.fuel === "Uranium"
    ? "nuclear"
    : facility.name.toLowerCase();
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
      return <RemoveIcon style={style} />;
    case "CHARGING":
      return <ArrowUpwardIcon style={style} />;
    case "DISCHARGING":
      return <ArrowDownwardIcon style={style} />;
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

function FacilityActions(props: {
  facility: FacilityOperatingType;
  upgrading: boolean;
  onPause: DispatchProps["onPause"];
  onTogglePause: DispatchProps["onTogglePause"];
  onCancelRetrofit?: DispatchProps["onCancelRetrofit"];
  onOpenSell: () => void;
}) {
  const {
    facility,
    onOpenSell,
    onPause,
    onTogglePause,
    upgrading,
    onCancelRetrofit,
  } = props;
  const underConstruction = facility.yearsToBuildLeft > 0;
  return (
    <div className="facilityActions">
      {upgrading && onCancelRetrofit && (
        // Refunds in full and returns the plant to service at once, so it needs no confirmation
        <Button
          className="facilityCancelConstruction"
          variant="outlined"
          startIcon={<CancelIcon />}
          aria-label={"Cancel upgrade of " + facility.name}
          onClick={() => onCancelRetrofit(facility.id)}
        >
          <span className="facilityActionLabel">Cancel upgrade</span>
        </Button>
      )}
      {!underConstruction && !upgrading && (
        <Button
          variant="outlined"
          startIcon={
            <ConceptIcon concept={facility.paused ? "play" : "pause"} />
          }
          aria-label={
            facility.paused
              ? "Resume " + facility.name
              : "Pause " + facility.name
          }
          onClick={() =>
            facility.paused
              ? onTogglePause(facility.id)
              : onPause(facility.id, facility.name)
          }
        >
          <span className="facilityActionLabel">
            {facility.paused ? "Resume" : "Pause"}
          </span>
        </Button>
      )}
      <Button
        className={underConstruction ? "facilityCancelConstruction" : undefined}
        variant="outlined"
        startIcon={underConstruction ? <CancelIcon /> : <DeleteForeverIcon />}
        aria-label={
          (underConstruction ? "Cancel construction of " : "Sell ") +
          facility.name
        }
        onClick={onOpenSell}
      >
        <span className="facilityActionLabel">
          {underConstruction ? "Cancel construction" : "Sell"}
        </span>
      </Button>
    </div>
  );
}

const MemoizedFacilityActions = React.memo(
  FacilityActions,
  (previous, next) => {
    const previousUnderConstruction = previous.facility.yearsToBuildLeft > 0;
    const nextUnderConstruction = next.facility.yearsToBuildLeft > 0;
    return (
      previous.facility.id === next.facility.id &&
      previous.facility.name === next.facility.name &&
      previous.facility.paused === next.facility.paused &&
      previousUnderConstruction === nextUnderConstruction &&
      previous.upgrading === next.upgrading &&
      previous.onCancelRetrofit === next.onCancelRetrofit &&
      previous.onPause === next.onPause &&
      previous.onTogglePause === next.onTogglePause &&
      previous.onOpenSell === next.onOpenSell
    );
  },
);

function FacilityListItem(props: FacilityListItemProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const toggleDialog = React.useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const {
    facility,
    game,
    onTogglePause,
    onPause,
    selected,
    storyOutputMultiplier,
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
  const installing = underConstruction
    ? undefined
    : upgradeInProgress(facility);
  const upgrading = !!installing && isUpgradingAt(facility, game.date.minute);
  const partialUpgrade =
    upgrading && retrofitOutputMultiplier(facility, game.date.minute) > 0;
  const offlineForWork = underConstruction || (upgrading && !partialUpgrade);
  const activityLabel = partialUpgrade
    ? "installing winterization, 90% capacity available"
    : undefined;
  const storage = isStorage(facility) ? facility : undefined;
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
  } else if (upgrading) {
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
      ? Math.max(-1, Math.min(1, facility.currentW / facility.peakW))
      : 0;
  // The row's second line has to stay one line on a 360px phone, so it leads with the reading
  // and the state and leaves anything else to a trailing detail that truncates first. Rated
  // storage power and the reservoir's absolute size are both in the opened details.
  const builtFraction = upgrading
    ? upgradeProgress(installing!, game.date.minute)
    : underConstruction
      ? Math.max(
          0,
          Math.min(
            1,
            (facility.yearsToBuild - facility.yearsToBuildLeft) /
              facility.yearsToBuild,
          ),
        )
      : 1;
  let reading = "";
  let detail: React.ReactNode = null;
  if (underConstruction) {
    const monthsLeft = Math.ceil(props.facility.yearsToBuildLeft * 12);
    const percentBuilt = Math.round(builtFraction * 100);
    reading = `Building ${percentBuilt}%`;
    detail = `${monthsLeft} ${monthsLeft === 1 ? "month" : "months"} left`;
  } else if (upgrading) {
    const daysLeft = upgradeDaysLeft(installing!, game.date.minute);
    reading = partialUpgrade
      ? formatWattsOfPeak(facility.currentW, facility.peakW)
      : `Upgrading ${Math.round(builtFraction * 100)}%`;
    detail = (
      <>
        <span className="facilityStatusLong">
          {partialUpgrade
            ? `Winterizing ${Math.round(builtFraction * 100)}% · 90% capacity available`
            : resilienceName(installing!.upgrade)}
          , {dayCount(daysLeft)} left
        </span>
        <span className="facilityStatusShort">{daysLeft}d left</span>
      </>
    );
  } else if (facility.peakWh) {
    reading = formatWattHoursOfPeak(facility.currentWh, facility.peakWh);
  } else {
    reading = formatWattsOfPeak(facility.currentW, facility.peakW);
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
  // Output communicates normal operation; keep explicit labels for other states.
  const status =
    offlineForWork || partialUpgrade || activity === "RUNNING"
      ? reading
      : `${reading} · ${ACTIVITY_LABELS[activity]}`;

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
          src={`/images/${facilityIconName(facility)}.svg`}
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
    <Draggable
      key={"f" + facility.id}
      draggableId={"f" + facility.id}
      index={props.spotInList}
      isDragDisabled={reorderDisabled}
      disableInteractiveElementBlocking
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`facilityRow${selected ? " selected" : ""}${props.bulkSelected ? " bulkSelected" : ""}${snapshot.isDragging ? " dragging" : ""}`}
          onContextMenu={(event) => props.onContextMenu(facility.id, event)}
          data-fuel={fuel}
          data-facility={facility.name}
          style={getDraggableStyle(provided.draggableProps.style)}
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
              className="facilityDisclosure"
              aria-label={
                `Inspect ${facility.name}` +
                (hazardStatus && !underConstruction
                  ? `, ${hazardStatusText(hazardStatus).spoken}`
                  : "") +
                (storage ? `, ${status}` : "")
              }
              aria-expanded={selected}
              aria-pressed={props.bulkSelected}
              onClick={(event) => props.onRowClick(facility.id, event)}
            >
              <ListItem className="facility" component="span">
                {reorderDisabled && icon}
                <span className="facilityText">
                  <ListItemText
                    slotProps={{
                      primary: { component: "span" },
                      secondary: { component: "span" },
                    }}
                    primary={
                      <>
                        <span className="facilityName">{facility.name}</span>
                        {ready && (
                          <span className="facilityReadyLabel">Ready</span>
                        )}
                        {storyOutputMultiplier < 1 && (
                          <Chip
                            className="storyDerateBadge"
                            color="warning"
                            size="small"
                            label={`${Math.round(storyOutputMultiplier * 100)}% limit`}
                            aria-label={`Temporarily limited to ${Math.round(storyOutputMultiplier * 100)}% of rated output`}
                          />
                        )}
                      </>
                    }
                    secondary={
                      <>
                        {hazardStatus && !underConstruction && (
                          <HazardStatusLead status={hazardStatus} />
                        )}
                        <span className="facilityStatus">{status}</span>
                        {detail && (
                          <span className="facilityStatusDetail">
                            <span
                              className="facilityStatusSeparator"
                              aria-hidden="true"
                            >
                              {" · "}
                            </span>
                            {detail}
                          </span>
                        )}
                      </>
                    }
                  />
                  {/* The percentage is already in the text; this only makes it glanceable */}
                  {(underConstruction || upgrading) && (
                    <span
                      className="constructionProgress"
                      data-paused={game.speed === "PAUSED"}
                      aria-hidden
                      style={{ background: withAlpha(accentColor, 0.24) }}
                    >
                      <span
                        className="constructionProgressFill"
                        style={{
                          width: `${builtFraction * 100}%`,
                          background: accentColor,
                        }}
                      />
                    </span>
                  )}
                </span>
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
            {props.showCheckboxes && (
              <Checkbox
                className="facilitySelectionCheckbox"
                size="small"
                checked={props.bulkSelected}
                onClick={(event) => props.onToggleSelection(facility.id, event)}
                slotProps={{
                  input: { "aria-label": `Select ${facility.name}` },
                }}
              />
            )}
          </div>
          {open && (
            // Inside the row, so isolateClicks keeps every click in the confirmation dialog
            // from also landing on the row behind it and toggling the selection
            <ConfirmDialog
              open
              isolateClicks
              title={
                <>
                  {underConstruction ? "Cancel construction of" : "Sell"}{" "}
                  {formatFacilitySize(facility)} {facility.name.toLowerCase()}{" "}
                  facility?
                </>
              }
              cancelLabel="Nevermind"
              confirmLabel={underConstruction ? "Cancel construction" : "Sell"}
              onCancel={toggleDialog}
              onConfirm={() => {
                props.onSell(facility.id);
                toggleDialog();
              }}
            >
              {facility.hydroSiteId && (
                <DialogContentText>
                  {underConstruction
                    ? "Canceling frees this site."
                    : "Selling won't free this site."}
                </DialogContentText>
              )}
              <DialogContentText>
                You will receive{" "}
                {formatMoneyConcise(
                  facilityCashBack(facility, game.date.minute),
                )}
                {facility.loanAmountLeft > 0
                  ? ` and the rest will go towards paying off the remaining loan balance of ${formatMoneyConcise(facility.loanAmountLeft)}`
                  : ""}
                .
              </DialogContentText>
            </ConfirmDialog>
          )}
          {selected && (
            <FacilityDetails
              facility={facility}
              date={game.date}
              seed={game.seed}
              location={game.location}
              game={game}
              onRetrofit={props.onRetrofit}
            />
          )}
          {selected && (
            <MemoizedFacilityActions
              facility={facility}
              upgrading={upgrading}
              onPause={onPause}
              onTogglePause={onTogglePause}
              onCancelRetrofit={props.onCancelRetrofit}
              onOpenSell={toggleDialog}
            />
          )}
        </div>
      )}
    </Draggable>
  );
}

// Always drawn rather than behind a phone-only disclosure: on a phone the chart scrolls away
// with the rest of the pane (see .facilitiesBody), the way Insights does, instead of pinning
// 180px above the fleet or making the player open it first
function FacilitySupplyChart({
  game,
  anchor,
}: {
  game: GameType;
  anchor: React.RefObject<HTMLDivElement>;
}) {
  const fuelOrder = getDispatchOrderedFuels(game.facilities);
  return (
    <div
      ref={anchor}
      tabIndex={-1}
      className="operatingEvidence facilitySupplyChart"
      aria-label="Supply and demand"
    >
      <ChartSupplyDemand
        height={180}
        timeline={game.timeline}
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

export interface StateProps {
  arrivingFacilityId?: number;
  evidenceRequest?: EvidenceRequestType;
  facilityDragActive?: boolean;
  game: GameType;
  // The row the player has open, from the UI slice rather than this component's own state:
  // Insights reads it too, and building a facility unmounts this pane
  selectedFacilityId: number | null;
}

export interface DispatchProps {
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
  onTransmissionBuild: (corridorId: string, financed: boolean) => void;
  onTransmissionCancel?: (id: number) => void;
  onTransmissionPause?: (id: number, name: string, paused: boolean) => void;
  onTransmissionUpgrade: (corridorId: string, financed: boolean) => void;
  onTradingPolicy: (policy: TradingPolicyType) => void;
}

export interface Props extends StateProps, DispatchProps {}

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
  private selectionFocus: HTMLButtonElement | null = null;
  private previewFocus: HTMLButtonElement | null = null;
  private menuFocus: HTMLButtonElement | null = null;

  private mouseEnabled = () =>
    window.matchMedia("(any-pointer: fine)").matches &&
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
      !this.scrollBody?.closest("[inert]") &&
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

  public componentDidUpdate() {
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

  private resolveEvidence() {
    const request = this.props.evidenceRequest;
    if (!request || this.dragging || this.props.facilityDragActive) return;
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
      onSell,
      onTogglePause,
      onPause,
      onTransmissionBuild,
      onTransmissionUpgrade,
      onTradingPolicy,
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
    const intertiesAvailable = !!(
      game.transmission &&
      (game.multiplayer || corridorsForLocation(game.location).length)
    );
    const storyEffects = combineStoryEffects(
      game.worldEvents.active.filter(
        (event) =>
          game.date.minute >= event.startsMinute &&
          game.date.minute < event.endsMinute &&
          !isWeatherHazardEvent(event.definitionId),
      ),
    );

    return (
      <GameCard className="facilities" id="facilitiesPane">
        <>
          <div className="scrollable facilitiesBody" ref={this.setScrollBody}>
            <FacilitySupplyChart game={game} anchor={this.evidenceAnchor} />
            {!(
              game.inGame &&
              activeScenario(game)?.tutorialSteps?.[
                game.tutorialStep
              ]?.hideUi?.includes("facilityActions")
            ) && (
              <div
                className="facilitySelectionBar"
                onKeyDown={this.onSelectionKeyDown}
              >
                {selectionMode || selection.length > 1 ? (
                  <>
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
                      <Button size="small" onClick={this.clearSelection}>
                        Clear selection
                      </Button>
                    </div>
                  </>
                ) : (
                  <span>
                    Shift-click a range · Ctrl/⌘-click to add · Right-click for
                    actions
                  </span>
                )}
              </div>
            )}
            <List
              dense
              className="scrollable unifiedFacilitiesList"
              data-group-dragging={this.state.groupDragging || undefined}
              onKeyDown={this.onSelectionKeyDown}
            >
              {intertiesAvailable && !!game.transmission?.lines.length && (
                <Typography
                  id="dispatch-order"
                  className="facilitySectionLabel"
                  variant="overline"
                >
                  Plants & storage
                  <span className="facilitySectionFlow">
                    {"Generating " + formatWatts(currentGenerationW(game))}
                  </span>
                </Typography>
              )}
              <DragDropContext
                onBeforeDragStart={this.onBeforeDragStart}
                onDragEnd={this.onDragEnd}
              >
                <Droppable droppableId="droppable">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef}>
                      {game.facilities.map(
                        (g: FacilityOperatingType, i: number) => (
                          <FacilityListItem
                            arriving={this.props.arrivingFacilityId === g.id}
                            onArrivalShown={this.props.onArrivalShown}
                            facility={g}
                            game={game}
                            key={g.id}
                            onSell={onSell}
                            onTogglePause={onTogglePause}
                            onPause={onPause}
                            onRetrofit={this.props.onRetrofit}
                            onCancelRetrofit={this.props.onCancelRetrofit}
                            onRowClick={this.onRowClick}
                            onContextMenu={this.onContextMenu}
                            bulkSelected={selection.some((f) => f.id === g.id)}
                            selectionEnabled={selectionEnabled}
                            showCheckboxes={showCheckboxes}
                            onToggleSelection={this.onToggleSelection}
                            selectionCount={selection.length}
                            selected={selectedFacilityId === g.id}
                            storyOutputMultiplier={storyOutputMultiplier(
                              g,
                              storyEffects,
                            )}
                            hazardStatus={facilityHazardStatus(game, g)}
                            spotInList={i}
                          />
                        ),
                      )}
                      {provided.placeholder}
                    </div>
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
              {intertiesAvailable && !!game.transmission?.lines.length && (
                <TransmissionPanel
                  game={game}
                  onBuild={onTransmissionBuild}
                  onUpgrade={onTransmissionUpgrade}
                  onCancel={this.props.onTransmissionCancel}
                  onPause={this.props.onTransmissionPause}
                  onPolicy={onTradingPolicy}
                  onBeforeDragStart={this.onBeforeDragStart}
                  onDragEnd={this.onDragEnd}
                />
              )}
            </List>
          </div>
          <FacilityContextMenu
            game={game}
            target={this.state.menu}
            onClose={this.closeMenu}
            onMenuExited={this.restoreSelectionFocus}
            onSell={onSell}
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
