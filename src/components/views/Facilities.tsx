import * as React from "react";
import {
  Avatar,
  Button,
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
import PauseIcon from "@mui/icons-material/Pause";
import PlayIcon from "@mui/icons-material/PlayArrow";
import CancelIcon from "@mui/icons-material/Cancel";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import BoltIcon from "@mui/icons-material/Bolt";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
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

interface FacilityListItemProps {
  facility: FacilityOperatingType;
  spotInList: number;
  listLength: number;
  game: GameType;
  selected: boolean;
  onSelect: (id: FacilityOperatingType["id"] | null) => void;
  // A replay is a recording of somebody else's decisions; letting the viewer make their own
  // would desync the run from the actions still queued up against it
  readOnly: boolean;
  onTogglePause: DispatchProps["onTogglePause"];
  onPause: DispatchProps["onPause"];
  onSell: DispatchProps["onSell"];
  onReprioritize: DispatchProps["onReprioritize"];
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
      return <HourglassEmptyIcon style={style} />;
    case "PAUSED":
      return <PauseIcon style={style} />;
    case "IDLE":
      return <PowerSettingsNewIcon style={style} />;
    case "CHARGING":
      return <ArrowUpwardIcon style={style} />;
    case "DISCHARGING":
      return <ArrowDownwardIcon style={style} />;
    default:
      return <BoltIcon style={style} />;
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

function FacilityListItem(props: FacilityListItemProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const toggleDialog = () => {
    setOpen(!open);
  };

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
    const percentBuilt = Math.round(
      ((facility.yearsToBuild - facility.yearsToBuildLeft) /
        facility.yearsToBuild) *
        100,
    );
    secondaryText = `Building: ${percentBuilt}%, ${Math.ceil(props.facility.yearsToBuildLeft * 12)} months left`;
  } else if (facility.peakWh) {
    secondaryText = `${formatWattHoursOfPeak(facility.currentWh, facility.peakWh)}, ${formatWatts(facility.peakW)}`;
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
              // Hidden until the row is hovered, focused or selected (desktop only - see
              // app.scss), because a permanent cluster of buttons takes the width the numbers
              // below want. Each one stops its click short of the row, which would otherwise
              // read the same click as "select this facility" on the way past
              <span className="facilityActions">
                {!readOnly && props.listLength > 1 && (
                  <>
                    {/* Dispatch order is a core mechanic, and dragging was the only way to set
                        it - undiscoverable with a mouse, and unusable once the list has
                        scrolled. These move one place at a time, the way a drag does */}
                    <IconButton
                      onClick={(e: React.MouseEvent) => {
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
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onReprioritize(spotInList, 1);
                      }}
                      aria-label={`Move ${facility.name} later in the dispatch order`}
                      disabled={spotInList === props.listLength - 1}
                      edge="end"
                      color="primary"
                      size="small"
                    >
                      <KeyboardArrowDownIcon />
                    </IconButton>
                  </>
                )}
                {!readOnly &&
                  !underConstruction &&
                  props.listLength > 1 &&
                  !facility.paused && (
                    <IconButton
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onPause(facility.id, facility.name);
                      }}
                      aria-label={`Pause ${facility.name}`}
                      edge="end"
                      color="primary"
                      size="small"
                    >
                      <PauseIcon />
                    </IconButton>
                  )}
                {!readOnly && facility.paused && (
                  <IconButton
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onTogglePause(facility.id);
                    }}
                    aria-label={`Resume ${facility.name}`}
                    edge="end"
                    color="primary"
                    size="small"
                  >
                    <PlayIcon />
                  </IconButton>
                )}
                {!readOnly && !underConstruction && props.listLength > 1 && (
                  <IconButton
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      toggleDialog();
                    }}
                    aria-label={`Sell ${facility.name}`}
                    edge="end"
                    color="primary"
                    size="small"
                  >
                    <DeleteForeverIcon />
                  </IconButton>
                )}
                {!readOnly && underConstruction && (
                  <IconButton
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      toggleDialog();
                    }}
                    aria-label={`Cancel construction of ${facility.name}`}
                    edge="end"
                    color="primary"
                    size="small"
                  >
                    <CancelIcon />
                  </IconButton>
                )}
              </span>
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
                  width: `${outputFraction * 100}%`,
                  background: withAlpha(accentColor, 0.18),
                }}
              />
            )}
            <ListItemAvatar>
              <div>
                <Avatar
                  className={facility.currentWh === 0 ? "offline" : ""}
                  alt={facility.name}
                  src={`/images/${facility.name.toLowerCase()}.svg`}
                />
                {facility.peakWh > 0 && !underConstruction && (
                  <div
                    className="capacityProgressBar"
                    style={{
                      height: `${(facility.currentWh / facility.peakWh) * 100}%`,
                      backgroundColor:
                        activity === "CHARGING"
                          ? chartPalette().storage
                          : undefined,
                    }}
                  />
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
            <ListItemText primary={facility.name} secondary={secondaryText} />
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
                    {formatMoneyConcise(facilityCashBack(facility))}
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
  onSelect: (id: FacilityOperatingType["id"] | null) => void;
  onStorageBuild: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Facilities extends React.Component<Props, {}> {
  constructor(props: Props) {
    super(props);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  private throttle = new TickThrottle();

  // In fast mode, skip frames so that CPU can focus on simulation. This used to be 1 frame in
  // 8, when the supply/demand chart was on Victory and one pane render cost 18ms; on uPlot the
  // same render is 3.6ms, so 1 in 2 refreshes the pane four times as often and still costs less
  // per tick than the old setting did.
  public shouldComponentUpdate(nextProps: Props) {
    // Opening a row is something the player just did, not something the clock did, so it
    // goes through whatever the throttle is up to - otherwise the row waits for the next
    // unskipped frame, and at FAST that reads as a click that missed
    if (
      nextProps.game.speed !== "FAST" ||
      nextProps.selectedFacilityId !== this.props.selectedFacilityId
    ) {
      return true;
    }
    return this.throttle.due(nextProps.game.date.minute, 2);
  }

  public componentDidUpdate() {
    this.throttle.rendered(this.props.game.date.minute);
  }

  public onDragEnd(result: DropResult) {
    if (!result.destination) {
      // dropped outside the list
      return;
    }

    this.props.onReprioritize(
      result.source.index,
      result.destination.index - result.source.index,
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
              >
                + Generator
              </Button>
              &nbsp;&nbsp;&nbsp;
              <Button
                size="small"
                variant="outlined"
                color="primary"
                onClick={onStorageBuild}
                className="button-buildStorage"
              >
                + Storage
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
          <DragDropContext onDragEnd={this.onDragEnd}>
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
