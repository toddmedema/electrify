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
  IconButton,
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
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
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
import FacilityDetails from "../base/FacilityDetails";
import GameCard from "../base/GameCard";
import ConceptIcon from "../base/ConceptIcon";
import { combineStoryEffects } from "../../data/WorldEvents";

interface FacilityListItemProps {
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
  isDragging: boolean,
  draggableStyle: DraggingStyle | NotDraggingStyle | undefined,
): React.CSSProperties => ({
  userSelect: "none",
  border: isDragging ? `1px solid rgba(30, 136, 229, 0.5)` : "none", // Match buttons
  borderRadius: isDragging ? `4px` : "0",
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
      return <PowerSettingsNewIcon style={style} />;
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
  const underConstruction = facility.yearsToBuildLeft > 0;
  return (
    <span className="facilityActions">
      {!readOnly && listLength > 1 && (
        <>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onReprioritize(spotInList, -1);
            }}
            aria-label={`Move ${facility.name} earlier in the dispatch order`}
            disabled={spotInList === 0}
            edge="end"
            color="primary"
            size="small"
          >
            <KeyboardArrowUpIcon />
          </IconButton>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              onReprioritize(spotInList, 1);
            }}
            aria-label={`Move ${facility.name} later in the dispatch order`}
            disabled={spotInList === listLength - 1}
            edge="end"
            color="primary"
            size="small"
          >
            <KeyboardArrowDownIcon />
          </IconButton>
        </>
      )}
      {!readOnly && !underConstruction && !facility.paused && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onPause(facility.id, facility.name);
          }}
          aria-label={`Pause ${facility.name}`}
          edge="end"
          color="primary"
          size="small"
        >
          <ConceptIcon concept="pause" />
        </IconButton>
      )}
      {!readOnly && facility.paused && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onTogglePause(facility.id);
          }}
          aria-label={`Resume ${facility.name}`}
          edge="end"
          color="primary"
          size="small"
        >
          <ConceptIcon concept="play" />
        </IconButton>
      )}
      {!readOnly && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            onOpenSell();
          }}
          aria-label={`${underConstruction ? "Cancel construction of" : "Sell"} ${facility.name}`}
          edge="end"
          color="primary"
          size="small"
        >
          {underConstruction ? <CancelIcon /> : <DeleteForeverIcon />}
        </IconButton>
      )}
    </span>
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
  } = props;
  const underConstruction = facility.yearsToBuildLeft > 0;
  const isStorage = facility.peakWh > 0;

  // Storage is charging or discharging depending on which way its stored energy moved since the
  // last tick, which is only knowable by remembering the last one
  const previousWh = React.useRef(facility.currentWh);
  const whDelta = facility.currentWh - previousWh.current;
  React.useEffect(() => {
    previousWh.current = facility.currentWh;
  });

  let activity: FacilityActivityType = "RUNNING";
  if (underConstruction) {
    activity = "BUILDING";
  } else if (facility.paused) {
    activity = "PAUSED";
  } else if (isStorage) {
    // A battery holding steady is neither charging nor discharging, so don't claim either
    activity = whDelta > 0 ? "CHARGING" : whDelta < 0 ? "DISCHARGING" : "IDLE";
  } else if (facility.currentW <= 0) {
    activity = "IDLE";
  }

  const fuel = (facility as Partial<GeneratorOperatingType>).fuel;
  const accentColor = facilityColor(fuel);
  const outputFraction =
    facility.peakW > 0 ? Math.min(1, facility.currentW / facility.peakW) : 0;
  let secondaryText = "";
  if (underConstruction) {
    const monthsLeft = Math.ceil(props.facility.yearsToBuildLeft * 12);
    const percentBuilt = Math.round(
      ((facility.yearsToBuild - facility.yearsToBuildLeft) /
        facility.yearsToBuild) *
        100,
    );
    secondaryText = `Building: ${percentBuilt}%, ${monthsLeft} ${monthsLeft === 1 ? "month" : "months"} left`;
  } else if (facility.peakWh) {
    secondaryText = `${formatWattHoursOfPeak(facility.currentWh, facility.peakWh)}, ${formatWatts(facility.peakW)}`;
  } else if (fuel === "Hydro" && facility.reservoirCapacityWh) {
    secondaryText = `${formatWattsOfPeak(facility.currentW, facility.peakW)}, reservoir ${formatWattHoursOfPeak(facility.reservoirWh || 0, facility.reservoirCapacityWh)}`;
  } else {
    secondaryText = formatWattsOfPeak(facility.currentW, facility.peakW);
  }

  return (
    <Draggable
      key={"f" + facility.id}
      draggableId={"f" + facility.id}
      index={props.spotInList}
      isDragDisabled={readOnly}
    >
      {(provided, snapshot) => (
        // Selecting is on the row rather than on a control inside it: the icon buttons were
        // the only thing a click did anything to, which is the opposite of what a list of
        // rows leads a mouse to expect. dragHandleProps already makes this focusable and
        // announces it as a button, so only a read-only row - which gets none of them - has
        // to say so itself. dnd owns Space (lift) and the arrows (move), leaving Enter free
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={selected ? "facilityRow selected" : "facilityRow"}
          role={provided.dragHandleProps ? undefined : "button"}
          tabIndex={provided.dragHandleProps ? undefined : 0}
          aria-expanded={selected}
          onClick={() => onSelect(selected ? null : facility.id)}
          onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSelect(selected ? null : facility.id);
            }
          }}
          style={getDraggableStyle(
            snapshot.isDragging,
            provided.draggableProps.style,
          )}
        >
          {/* v9 dropped ListItem's `disabled` prop; it only ever dimmed the row, which is
              all under-construction facilities need here. */}
          <ListItem
            className="facility"
            sx={
              underConstruction
                ? { opacity: (theme) => theme.palette.action.disabledOpacity }
                : undefined
            }
            secondaryAction={
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
            }
          >
            {!readOnly && (
              <DragIndicatorIcon
                className="draggable-indicator"
                color="primary"
              />
            )}
            {/* Tinted by fuel so the list reads as the same dispatch stack the supply-by-fuel
                chart draws, and transitioned in CSS so ramping is visible as movement */}
            {!underConstruction && (
              <div
                className="outputProgressBar"
                style={{
                  transform: `scaleX(${outputFraction})`,
                  background: withAlpha(accentColor, 0.18),
                }}
              />
            )}
            <ListItemAvatar>
              <div>
                <Avatar
                  className={facility.currentWh === 0 ? "offline" : ""}
                  alt={facility.name}
                  src={`/images/${facilityIconName(facility)}.svg`}
                />
                {facility.peakWh > 0 && !underConstruction && (
                  <div className="capacityProgressBar">
                    <div
                      className="capacityProgressBarFill"
                      style={{
                        transform: `scaleY(${facility.currentWh / facility.peakWh})`,
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
            <ListItemText
              primary={
                <>
                  {facility.name}
                  {storyOutputMultiplier < 1 && (
                    <Chip
                      className="storyDerateBadge"
                      color="warning"
                      size="small"
                      label={`Limited to ${Math.round(storyOutputMultiplier * 100)}%`}
                      aria-label={`Temporarily limited to ${Math.round(storyOutputMultiplier * 100)}% of rated output`}
                    />
                  )}
                </>
              }
              secondary={secondaryText}
            />
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
          </ListItem>
          {selected && (
            <FacilityDetails
              facility={facility}
              date={game.date}
              seed={game.seed}
              location={game.location}
            />
          )}
        </div>
      )}
    </Draggable>
  );
}

export interface StateProps {
  game: GameType;
  // The row the player has open, from the UI slice rather than this component's own state:
  // Finances and Forecasts read it too, and building a facility unmounts this pane
  selectedFacilityId: number | null;
}

export interface DispatchProps {
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
}

export interface Props extends StateProps, DispatchProps {}

export default class Facilities extends React.Component<Props, {}> {
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
    this.throttle.rendered(this.props.game.date.minute);
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
      onStorageBuild,
      selectedFacilityId,
    } = this.props;
    const facilitiesCount = game.facilities.length;
    const readOnly = !!game.replayPlayback;
    const storyEffects = combineStoryEffects(
      game.worldEvents.active.filter(
        (event) =>
          game.date.minute >= event.startsMinute &&
          game.date.minute < event.endsMinute,
      ),
    );

    return (
      <GameCard className="facilities" id="facilitiesPane">
        {/* The pane's own header rather than a row inside the list, so it lines up with the
            other panes' headers and the build buttons stay put as the fleet scrolls */}
        <Toolbar className="paneHeader">
          <Typography variant="h6">Facilities</Typography>
          {!readOnly && (
            <>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={onGeneratorBuild}
                className="button-buildGenerator"
                startIcon={<ConceptIcon concept="generator" fontSize="small" />}
              >
                Generator
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={onStorageBuild}
                className="button-buildStorage"
                startIcon={<ConceptIcon concept="storage" fontSize="small" />}
              >
                Storage
              </Button>
            </>
          )}
        </Toolbar>
        <ChartSupplyDemand
          height={180}
          timeline={game.timeline}
          currentMinute={game.date.minute}
          location={game.location}
          legend={game.speed === "PAUSED"}
          startingYear={game.startingYear}
        />
        <List dense className="scrollable">
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
              (click "Generator" or "Storage" to build more)
            </Typography>
          )}
        </List>
      </GameCard>
    );
  }
}
