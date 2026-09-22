import * as React from "react";
import {
  Avatar,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import CancelIcon from "@mui/icons-material/Cancel";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RemoveIcon from "@mui/icons-material/Remove";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
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
  GameType,
  GeneratorOperatingType,
  WorldEventEffectsType,
  EvidenceRequestType,
} from "../../Types";
import { facilityCashBack } from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWattHoursOfPeak,
  formatWatts,
  formatWattsOfPeak,
} from "../../helpers/Format";
import ChartSupplyDemand from "../base/ChartSupplyDemand";
import FlowBar from "../base/FlowBar";
import FacilityDetails from "../base/FacilityDetails";
import GameCard from "../base/GameCard";
import ConceptIcon from "../base/ConceptIcon";
import { combineStoryEffects } from "../../data/WorldEvents";
import TransmissionPanel from "./TransmissionPanel";
import { TradingPolicyType } from "../../Types";
import { corridorsForLocation } from "../../data/AdjacentMarkets";

interface FacilityListItemProps {
  arriving: boolean;
  onArrivalShown?: (id: number) => void;
  facility: FacilityOperatingType;
  spotInList: number;
  listLength: number;
  game: GameType;
  selected: boolean;
  storyOutputMultiplier: number;
  onSelect: (id: FacilityOperatingType["id"] | null) => void;
  // A replay is a recording of somebody else's decisions; letting the viewer make their own
  // would desync the run from the actions still queued up against it
  readOnly: boolean;
  onTogglePause: DispatchProps["onTogglePause"];
  onPause: DispatchProps["onPause"];
  onSell: DispatchProps["onSell"];
  onReprioritize: DispatchProps["onReprioritize"];
}

function storyOutputMultiplierForFacility(
  facility: FacilityOperatingType,
  effects: WorldEventEffectsType,
): number {
  const fuel = (facility as Partial<GeneratorOperatingType>).fuel;
  return (
    (effects.facilityOutputMultipliersById?.[String(facility.id)] || 1) *
    (fuel ? effects.facilityOutputMultipliersByFuel?.[fuel] || 1 : 1)
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
  "BUILDING" | "PAUSED" | "IDLE" | "RUNNING" | "CHARGING" | "DISCHARGING";

function activityIcon(activity: FacilityActivityType, color: string) {
  const style = { color };
  switch (activity) {
    case "BUILDING":
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
  PAUSED: "paused",
  IDLE: "idle",
  RUNNING: "running",
  CHARGING: "charging",
  DISCHARGING: "discharging",
};

// Display only: the row turns its reservoir reading red when the *displayed* integer falls below
// this, so the number and its colour always agree -- which puts the effective cutoff at 19.5%,
// the point where rounding first lands on 19. Deliberately above LOW_RESERVOIR_FRACTION
// (HydroOutlook), which marks the point where output is already being held back and drives the
// "Nearly empty." forecast lead -- the row warns before that bites.
const RESERVOIR_WARNING_FRACTION = 0.2;

function FacilityActions(props: {
  facility: FacilityOperatingType;
  listLength: number;
  readOnly: boolean;
  spotInList: number;
  onPause: DispatchProps["onPause"];
  onReprioritize: DispatchProps["onReprioritize"];
  onTogglePause: DispatchProps["onTogglePause"];
  onOpenSell: () => void;
}) {
  const {
    facility,
    listLength,
    onOpenSell,
    onPause,
    onReprioritize,
    onTogglePause,
    readOnly,
    spotInList,
  } = props;
  if (readOnly) return null;
  const underConstruction = facility.yearsToBuildLeft > 0;
  return (
    <div className="facilityActions">
      {!underConstruction && (
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
      {listLength > 1 && (
        <>
          <Button
            startIcon={<KeyboardArrowUpIcon />}
            aria-label={
              "Move " + facility.name + " earlier in the dispatch order"
            }
            disabled={spotInList === 0}
            onClick={() => onReprioritize(spotInList, -1)}
          >
            <span className="facilityActionLabel">Move up</span>
          </Button>
          <Button
            startIcon={<KeyboardArrowDownIcon />}
            aria-label={
              "Move " + facility.name + " later in the dispatch order"
            }
            disabled={spotInList === listLength - 1}
            onClick={() => onReprioritize(spotInList, 1)}
          >
            <span className="facilityActionLabel">Move down</span>
          </Button>
        </>
      )}
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
      previous.listLength === next.listLength &&
      previous.readOnly === next.readOnly &&
      previous.spotInList === next.spotInList &&
      previous.onPause === next.onPause &&
      previous.onReprioritize === next.onReprioritize &&
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
    onReprioritize,
    onSelect,
    readOnly,
    selected,
    spotInList,
    storyOutputMultiplier,
    arriving: arrivalRequested,
    onArrivalShown,
  } = props;
  const underConstruction = facility.yearsToBuildLeft > 0;
  const isStorage = facility.peakWh > 0;
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
    if (wasBuilding.current && !underConstruction && !readOnly) {
      setReady(true);
    }
    wasBuilding.current = underConstruction;
  }, [underConstruction, readOnly]);
  React.useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setReady(false), 2400);
    return () => window.clearTimeout(timer);
  }, [ready]);

  let activity: FacilityActivityType = "RUNNING";
  if (underConstruction) {
    activity = "BUILDING";
  } else if (facility.paused) {
    activity = "PAUSED";
  } else if (isStorage) {
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

  const fuel = (facility as Partial<GeneratorOperatingType>).fuel;
  const accentColor = facilityColor(fuel);
  const capacityFraction = isStorage
    ? facility.currentWh / facility.peakWh
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
  const builtFraction = underConstruction
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
  } else if (facility.peakWh) {
    reading = formatWattHoursOfPeak(facility.currentWh, facility.peakWh);
  } else {
    reading = formatWattsOfPeak(facility.currentW, facility.peakW);
    if (fuel === "Hydro" && facility.reservoirCapacityWh) {
      const reservoirFraction =
        (facility.reservoirWh || 0) / facility.reservoirCapacityWh;
      const reservoirPercent = Math.round(reservoirFraction * 100);
      // A dam this far down is heading for the minimum generating level, which is worth seeing
      // without opening the row. The reading turns red, and an off-screen "low" carries the
      // same message for anyone who can't use the colour.
      const low = reservoirPercent < RESERVOIR_WARNING_FRACTION * 100;
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
    underConstruction || activity === "RUNNING"
      ? reading
      : `${reading} · ${ACTIVITY_LABELS[activity]}`;

  return (
    <Draggable
      key={"f" + facility.id}
      draggableId={"f" + facility.id}
      index={props.spotInList}
      isDragDisabled={readOnly}
      disableInteractiveElementBlocking
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`facilityRow${selected ? " selected" : ""}${snapshot.isDragging ? " dragging" : ""}`}
          data-fuel={fuel}
          style={getDraggableStyle(provided.draggableProps.style)}
        >
          <div
            className={`facilityRowHeader${arriving && !readOnly ? " facilityArrival" : ""}${ready ? " facilityReady" : ""}`}
            data-storage={isStorage || undefined}
            onAnimationEnd={(event) => {
              if (event.animationName === "facilityArrival") setArriving(false);
            }}
          >
            {/* Behind the whole row, grip included, so the fill reads edge to edge. Tinted by
            fuel so the list reads as the same dispatch stack the supply-by-fuel chart draws, and
            transitioned in CSS so ramping is visible as movement */}
            {!underConstruction && (
              <FlowBar fraction={outputFraction} color={accentColor} />
            )}
            {!readOnly && (
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
                `Inspect ${facility.name}` + (isStorage ? `, ${status}` : "")
              }
              aria-expanded={selected}
              onClick={() => onSelect(selected ? null : facility.id)}
            >
              {/* v9 dropped ListItem's `disabled` prop; it only ever dimmed the row, which is
              all under-construction facilities need here. */}
              <ListItem
                className="facility"
                sx={
                  underConstruction
                    ? {
                        // The progress bar stays at full strength so the build is legible
                        "& .MuiListItemAvatar-root, & .MuiListItemText-primary, & .MuiListItemText-secondary":
                          {
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
                  {underConstruction && (
                    <span
                      className="constructionProgress"
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
                <KeyboardArrowDownIcon
                  className="facilityChevron"
                  aria-hidden
                />
              </ListItem>
            </button>
          </div>
          {open && (
            // Inside the row, so without this every click in the confirmation dialog also
            // lands on the row behind it and toggles the selection
            <Dialog
              open
              onClose={toggleDialog}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <DialogTitle>
                {underConstruction ? "Cancel construction of" : "Sell"}{" "}
                {facility.peakWh
                  ? formatWattHours(facility.peakWh)
                  : formatWatts(facility.peakW)}{" "}
                {facility.name.toLowerCase()} facility?
              </DialogTitle>
              <DialogContent>
                {facility.hydroSiteId && (
                  <DialogContentText>
                    {underConstruction
                      ? "Cancelling releases this unfinished project's Hydro site."
                      : "This commissioned Hydro site remains permanently used after sale."}
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
              </DialogContent>
              <DialogActions>
                <Button onClick={toggleDialog} color="primary">
                  Nevermind
                </Button>
                <Button
                  onClick={() => {
                    props.onSell(facility.id);
                    toggleDialog();
                  }}
                  color="primary"
                  variant="contained"
                  autoFocus
                >
                  {underConstruction ? "Cancel construction" : "Sell"}
                </Button>
              </DialogActions>
            </Dialog>
          )}
          {selected && (
            <MemoizedFacilityActions
              facility={facility}
              listLength={props.listLength}
              readOnly={readOnly}
              spotInList={spotInList}
              onPause={onPause}
              onReprioritize={onReprioritize}
              onTogglePause={onTogglePause}
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
  arrivingFacilityId?: number;
  evidenceRequest?: EvidenceRequestType;
  facilityDragActive?: boolean;
  game: GameType;
  // The row the player has open, from the UI slice rather than this component's own state:
  // Finances and Forecasts read it too, and building a facility unmounts this pane
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
  onFacilityDragStart: (speed: GameType["speed"]) => void;
  onFacilityDragEnd: (
    sourceIndex: number,
    destinationIndex: number | null,
    resumeSpeed: GameType["speed"],
  ) => void;
  onSelect: (id: FacilityOperatingType["id"] | null) => void;
  onStorageBuild: () => void;
  onTransmissionBuild: (corridorId: string, financed: boolean) => void;
  onTransmissionUpgrade: (corridorId: string, financed: boolean) => void;
  onTradingPolicy: (policy: TradingPolicyType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Facilities extends React.Component<Props> {
  constructor(props: Props) {
    super(props);
    this.onBeforeDragStart = this.onBeforeDragStart.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  private throttle = new TickThrottle();
  // The drag library already animates every row while a reorder is active. Letting the 10ms
  // FAST clock replace the whole list underneath it adds a second stream of layout work and can
  // make the pointer fall seconds behind. The drag callbacks briefly suspend that clock too;
  // this guard keeps an already-queued tick from replacing the rows before it stops.
  private dragging = false;
  private speedBeforeDrag: GameType["speed"] = "PAUSED";

  // Keep 1x presentation unchanged, but cap FAST's 100 simulation ticks/sec to 25 visual
  // refreshes/sec. Intermediate simulation ticks still run; the pane simply presents the newest.
  public shouldComponentUpdate(nextProps: Props) {
    if (this.dragging) {
      return false;
    }
    // Opening a row is something the player just did, not something the clock did, so it
    // goes through whatever the throttle is up to - otherwise the row waits for the next
    // unskipped frame, and at FAST that reads as a click that missed
    if (
      nextProps.evidenceRequest !== this.props.evidenceRequest ||
      nextProps.arrivingFacilityId !== this.props.arrivingFacilityId ||
      nextProps.facilityDragActive !== this.props.facilityDragActive ||
      nextProps.game.speed !== "FAST" ||
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

  public onBeforeDragStart() {
    this.dragging = true;
    this.speedBeforeDrag = this.props.game.speed;
    this.props.onFacilityDragStart(this.speedBeforeDrag);
  }

  public onDragEnd(result: DropResult) {
    this.dragging = false;
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
      onReprioritize,
      onSelect,
      onTransmissionBuild,
      onTransmissionUpgrade,
      onTradingPolicy,
      selectedFacilityId,
    } = this.props;
    const facilitiesCount = game.facilities.length;
    const readOnly = !!game.replayPlayback;
    const intertiesAvailable = !!(
      game.transmission && corridorsForLocation(game.location).length
    );
    const storyEffects = combineStoryEffects(
      game.worldEvents.active.filter(
        (event) =>
          game.date.minute >= event.startsMinute &&
          game.date.minute < event.endsMinute,
      ),
    );

    return (
      <GameCard className="facilities" id="facilitiesPane">
        <>
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
          <div className="scrollable facilitiesBody">
            <FacilitySupplyChart game={game} anchor={this.evidenceAnchor} />
            <List dense className="scrollable unifiedFacilitiesList">
              {intertiesAvailable && (
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
                            onReprioritize={onReprioritize}
                            onSelect={onSelect}
                            selected={selectedFacilityId === g.id}
                            storyOutputMultiplier={storyOutputMultiplierForFacility(
                              g,
                              storyEffects,
                            )}
                            spotInList={i}
                            listLength={facilitiesCount}
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
              {intertiesAvailable && (
                <TransmissionPanel
                  game={game}
                  onBuild={onTransmissionBuild}
                  onUpgrade={onTransmissionUpgrade}
                  onPolicy={onTradingPolicy}
                />
              )}
            </List>
          </div>
        </>
      </GameCard>
    );
  }
}
