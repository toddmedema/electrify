import * as React from "react";
import {
  Avatar,
  Button,
  Chip,
  DialogContentText,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
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
  NotDraggingStyle,
} from "@hello-pangea/dnd";
import { TickThrottle } from "../../helpers/RenderThrottle";
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
  formatWattsOfPeak,
  formatFacilitySize,
} from "../../helpers/Format";
import ChartSupplyDemand from "../base/ChartSupplyDemand";
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
  upgradeDaysLeft,
  upgradeInProgress,
  upgradeProgress,
} from "../../helpers/Hazards";
import { dayCount, resilienceName } from "../base/WeatherResilienceText";
import TransmissionPanel from "./TransmissionPanel";
import { TradingPolicyType } from "../../Types";
import { corridorsForLocation } from "../../data/AdjacentMarkets";
import { activeScenario } from "../../helpers/GameSelectors";
import FleetGrid from "./FleetGrid";
import { facilityReservoirReading } from "../base/FacilityReservoir";
import {
  FacilityFeedbackProvider,
  useFacilityFeedback,
} from "../base/FacilityFeedback";

interface FacilityListItemProps {
  reorderable?: boolean;
  showFeedback: boolean;
  facility: FacilityOperatingType;
  spotInList: number;
  game: GameType;
  selected: boolean;
  storyOutputMultiplier: number;
  hazardStatus?: FacilityHazardStatusType;
  onSelect: (id: FacilityOperatingType["id"] | null) => void;
  // A replay is a recording of somebody else's decisions; letting the viewer make their own
  // would desync the run from the actions still queued up against it
  readOnly: boolean;
  onTogglePause: DispatchProps["onTogglePause"];
  onPause: DispatchProps["onPause"];
  onSell: DispatchProps["onSell"];
  onRetrofit?: DispatchProps["onRetrofit"];
  onCancelRetrofit?: DispatchProps["onCancelRetrofit"];
}

/**
 * A weather outage leads the row's status line, in amber, so a damaged plant reads as damaged
 * before its reduced output does. The long and short forms swap on row width like the reservoir
 * reading.
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

function FacilityActions(props: {
  facility: FacilityOperatingType;
  readOnly: boolean;
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
    readOnly,
    upgrading,
    onCancelRetrofit,
  } = props;
  if (readOnly) return null;
  const underConstruction = facility.yearsToBuildLeft > 0;
  return (
    <div className="facilityActions">
      {upgrading && onCancelRetrofit && (
        // Refunds in full and returns the plant to service at once, so it needs no confirmation
        <Button
          className="facilityCancelConstruction"
          startIcon={<CancelIcon />}
          aria-label={"Cancel upgrade of " + facility.name}
          onClick={() => onCancelRetrofit(facility.id)}
        >
          <span className="facilityActionLabel">Cancel upgrade</span>
        </Button>
      )}
      {!underConstruction && !upgrading && (
        <Button
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
      previous.readOnly === next.readOnly &&
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
    onSelect,
    readOnly,
    selected,
    storyOutputMultiplier,
    hazardStatus,
  } = props;
  const underConstruction = facility.yearsToBuildLeft > 0;
  const installing = underConstruction
    ? undefined
    : upgradeInProgress(facility);
  const upgrading = !!installing && isUpgradingAt(facility, game.date.minute);
  // Building and upgrading both hold the plant out of service behind a progress bar
  const offlineForWork = underConstruction || upgrading;
  const storage = isStorage(facility) ? facility : undefined;
  const feedback = useFacilityFeedback();
  const arriving =
    props.showFeedback && feedback.arrivingFacilityId === facility.id;
  const ready = props.showFeedback
    ? feedback.milestones[facility.id]
    : undefined;

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
  // The row's second line has to stay one line on a 320px phone, so it leads with the reading
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
    reading = `Upgrading ${Math.round(builtFraction * 100)}%`;
    detail = (
      <>
        <span className="facilityStatusLong">
          {resilienceName(installing!.upgrade)}, {dayCount(daysLeft)} left
        </span>
        <span className="facilityStatusShort">{daysLeft}d left</span>
      </>
    );
  } else if (facility.peakWh) {
    reading = formatWattHoursOfPeak(facility.currentWh, facility.peakWh);
  } else {
    reading = formatWattsOfPeak(facility.currentW, facility.peakW);
    const reservoir = facilityReservoirReading(facility);
    if (reservoir) {
      // A dam this far down is heading for the minimum generating level, which is worth seeing
      // without opening the row. The reading turns red, and an off-screen "low" carries the
      // same message for anyone who can't use the colour.
      const { percent: reservoirPercent, low } = reservoir;
      // Only one of these shows, picked by how wide the row is
      detail = (
        <span className={low ? "facilityStatusLow" : undefined}>
          <span className="facilityStatusLong">
            reservoir {reservoirPercent}%
          </span>
          <span className="facilityStatusShort">{reservoirPercent}%</span>
          {low && <span className="srOnly"> low</span>}
        </span>
      );
    }
  }
  // Output communicates normal operation; keep explicit labels for other states.
  const status =
    offlineForWork || activity === "RUNNING"
      ? reading
      : `${reading} · ${ACTIVITY_LABELS[activity]}`;

  return (
    <Draggable
      key={"f" + facility.id}
      draggableId={"f" + facility.id}
      index={props.spotInList}
      isDragDisabled={readOnly || props.reorderable === false}
      disableInteractiveElementBlocking
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`facilityRow${selected ? " selected" : ""}${snapshot.isDragging ? " dragging" : ""}`}
          data-fuel={fuel}
          data-facility={facility.name}
          style={getDraggableStyle(provided.draggableProps.style)}
        >
          <div
            className={`facilityRowHeader${arriving && !readOnly ? " facilityArrival" : ""}${ready ? " facilityReady" : ""}`}
            data-storage={!!storage || undefined}
          >
            {/* Behind the whole row, grip included, so the fill reads edge to edge. Tinted by
            fuel so the list reads as the same dispatch stack the supply-by-fuel chart draws, and
            transitioned in CSS so ramping is visible as movement */}
            {!offlineForWork && <FlowBar fraction={outputFraction} />}
            {!readOnly && props.reorderable !== false && (
              <button
                type="button"
                {...provided.dragHandleProps}
                className="facilityDragHandle"
                aria-label={"Reorder " + facility.name}
              >
                <DragIndicatorIcon aria-hidden />
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
              onClick={() => onSelect(selected ? null : facility.id)}
            >
              {/* A project is inspectable while offline. Only its artwork is muted; progress
              and timing stay readable rather than resembling disabled controls. */}
              <ListItem
                className="facility"
                sx={
                  offlineForWork
                    ? {
                        "& .MuiListItemAvatar-root": {
                          opacity: (theme) =>
                            theme.palette.action.disabledOpacity,
                        },
                      }
                    : undefined
                }
                component="span"
              >
                <ListItemAvatar>
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
                              activity === "CHARGING"
                                ? chartPalette().storage
                                : undefined,
                          }}
                        />
                      </div>
                    )}
                    <div
                      className="facilityActivity"
                      role="img"
                      aria-label={`${facility.name} ${ACTIVITY_LABELS[activity]}`}
                    >
                      {activityIcon(activity, accentColor)}
                    </div>
                  </div>
                </ListItemAvatar>
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
                          <span className="facilityReadyLabel">{ready}</span>
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
                  {offlineForWork && (
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
                <ChevronDownGlyph className="facilityChevron" aria-hidden />
              </ListItem>
            </button>
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
                    ? "Cancelling frees this site."
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
            <MemoizedFacilityActions
              facility={facility}
              readOnly={readOnly}
              upgrading={upgrading}
              onPause={onPause}
              onTogglePause={onTogglePause}
              onCancelRetrofit={props.onCancelRetrofit}
              onOpenSell={toggleDialog}
            />
          )}
          {selected && (
            <FacilityDetails
              facility={facility}
              date={game.date}
              seed={game.seed}
              location={game.location}
              game={game}
              readOnly={readOnly}
              onRetrofit={props.onRetrofit}
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
        currentMinute={game.date.minute}
        location={game.location}
        legend
        startingYear={game.startingYear}
      />
    </div>
  );
}

export interface StateProps {
  feedbackRunId?: number;
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
  onGeneratorBuild: () => void;
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

interface State {
  view: "grid" | "dispatch";
}

export default class Facilities extends React.Component<Props, State> {
  state: State = { view: "grid" };
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
  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    if (this.dragging) {
      return false;
    }
    // Opening a row is something the player just did, not something the clock did, so it
    // goes through whatever the throttle is up to - otherwise the row waits for the next
    // unskipped frame, and at FAST that reads as a click that missed
    if (
      nextProps.game.speed !== this.props.game.speed ||
      nextState.view !== this.state.view ||
      nextProps.game.tutorialStep !== this.props.game.tutorialStep ||
      nextProps.evidenceRequest !== this.props.evidenceRequest ||
      nextProps.arrivingFacilityId !== this.props.arrivingFacilityId ||
      nextProps.feedbackRunId !== this.props.feedbackRunId ||
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

  public componentDidUpdate(previousProps: Props) {
    this.resolveEvidence();
    this.throttle.rendered(this.props.game.date.minute);
    if (
      this.state.view === "grid" &&
      this.props.selectedFacilityId !== null &&
      previousProps.selectedFacilityId !== this.props.selectedFacilityId
    ) {
      this.scrollBody
        ?.querySelector(".facilityRow.selected")
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  public componentDidMount() {
    this.resolveEvidence();
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
    if (request.target === "supply-demand" && this.state.view !== "dispatch") {
      // Keep the requested chart mounted after focus acknowledges and clears the request.
      this.setState({ view: "dispatch" });
      return;
    }
    this.props.onEvidenceReady?.(request, this.evidenceAnchor.current);
  }

  public onBeforeDragStart() {
    this.dragging = true;
    this.speedBeforeDrag = this.props.game.speed;
    this.props.onFacilityDragStart(this.speedBeforeDrag);
  }

  public onDragEnd(result: DropResult) {
    this.dragging = false;
    if (result.source.droppableId === "interties") {
      this.props.onFacilityDragEnd(
        result.source.index,
        result.destination?.index ?? null,
        this.speedBeforeDrag,
        true,
      );
      return;
    }
    this.props.onFacilityDragEnd(
      result.source.index,
      result.destination?.index ?? null,
      this.speedBeforeDrag,
    );
  }

  public render() {
    const {
      game,
      onGeneratorBuild,
      onSell,
      onTogglePause,
      onPause,
      onSelect,
      onTransmissionBuild,
      onTransmissionUpgrade,
      onTradingPolicy,
      selectedFacilityId,
    } = this.props;
    const facilitiesCount = game.facilities.length;
    const tutorialSteps = activeScenario(game)?.tutorialSteps;
    const tutorialActive = !!tutorialSteps?.[game.tutorialStep];
    const gridView =
      this.state.view === "grid" &&
      !tutorialActive &&
      this.props.evidenceRequest?.target !== "supply-demand";
    const visibleFacilities = gridView
      ? game.facilities.filter((facility) => facility.id === selectedFacilityId)
      : game.facilities;
    const readOnly = !!game.replayPlayback;
    const intertiesAvailable = !!(
      game.transmission && corridorsForLocation(game.location).length
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
        <FacilityFeedbackProvider
          key={`${this.props.feedbackRunId ?? 0}:${game.scenarioId}:${game.seed}`}
          game={game}
          arrivingFacilityId={this.props.arrivingFacilityId}
          onArrivalShown={this.props.onArrivalShown}
        >
          {/* The pane's own header rather than a row inside the list, so it lines up with the
            other panes' headers and the build buttons stay put as the fleet scrolls */}
          <Toolbar className="paneHeader">
            <Typography variant="h6">Facilities</Typography>
            {!readOnly && (
              <Button
                variant="contained"
                color="primary"
                className="button-buildFacility"
                startIcon={<ConceptIcon concept="build" fontSize="small" />}
                onClick={onGeneratorBuild}
              >
                Build
              </Button>
            )}
          </Toolbar>
          {!tutorialActive && (
            <div className="fleetViewSwitch" aria-label="Fleet view">
              <Button
                aria-pressed={gridView}
                onClick={() => this.setState({ view: "grid" })}
              >
                Grid
              </Button>
              <Button
                aria-pressed={!gridView}
                onClick={() => this.setState({ view: "dispatch" })}
              >
                Dispatch
              </Button>
            </div>
          )}
          <div
            className={`scrollable facilitiesBody${gridView ? " fleetGridBody" : ""}`}
            ref={this.setScrollBody}
          >
            {gridView ? (
              <div ref={this.evidenceAnchor} tabIndex={-1}>
                <FleetGrid
                  game={game}
                  selectedFacilityId={selectedFacilityId}
                  onSelect={onSelect}
                  onInspectInterties={() =>
                    this.setState({ view: "dispatch" }, () => {
                      this.scrollBody
                        ?.querySelector(".transmissionFleet")
                        ?.scrollIntoView({ block: "start" });
                    })
                  }
                />
              </div>
            ) : (
              <FacilitySupplyChart game={game} anchor={this.evidenceAnchor} />
            )}
            <List dense className="scrollable unifiedFacilitiesList">
              {!gridView &&
                intertiesAvailable &&
                !!game.transmission?.lines.length && (
                  <Typography
                    id="dispatch-order"
                    className="facilitySectionLabel"
                    variant="overline"
                  >
                    Plants & storage <span>Dispatch order</span>
                  </Typography>
                )}
              <DragDropContext
                onBeforeDragStart={this.onBeforeDragStart}
                onDragEnd={this.onDragEnd}
              >
                <Droppable droppableId="droppable">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef}>
                      {visibleFacilities.map(
                        (g: FacilityOperatingType, i: number) => (
                          <FacilityListItem
                            reorderable={!gridView}
                            showFeedback={!gridView}
                            facility={g}
                            game={game}
                            key={g.id}
                            onSell={onSell}
                            onTogglePause={onTogglePause}
                            onPause={onPause}
                            onRetrofit={this.props.onRetrofit}
                            onCancelRetrofit={this.props.onCancelRetrofit}
                            onSelect={onSelect}
                            selected={selectedFacilityId === g.id}
                            storyOutputMultiplier={storyOutputMultiplier(
                              g,
                              storyEffects,
                            )}
                            hazardStatus={facilityHazardStatus(game, g)}
                            spotInList={i}
                            readOnly={readOnly}
                          />
                        ),
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
              {facilitiesCount < 2 && !readOnly && (
                <Typography
                  color="textSecondary"
                  variant="body2"
                  style={{ textAlign: "center", marginTop: "12px" }}
                >
                  Choose Build to add a generator or storage.
                </Typography>
              )}
              {!gridView &&
                intertiesAvailable &&
                !!game.transmission?.lines.length && (
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
        </FacilityFeedbackProvider>
      </GameCard>
    );
  }
}
