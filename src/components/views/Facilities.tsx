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
  ListItemSecondaryAction,
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
import {
  DragDropContext,
  Draggable,
  DraggingStyle,
  Droppable,
  DropResult,
  NotDraggingStyle,
} from "@hello-pangea/dnd";
import { TICK_MINUTES } from "../../Constants";
import { fuelColors, storageColor, withAlpha } from "../../Theme";
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
import GameCard from "../base/GameCard";

interface FacilityListItemProps {
  facility: FacilityOperatingType;
  spotInList: number;
  listLength: number;
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
  | "BUILDING"
  | "PAUSED"
  | "IDLE"
  | "RUNNING"
  | "CHARGING"
  | "DISCHARGING";

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

function FacilityListItem(props: FacilityListItemProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const toggleDialog = () => {
    setOpen(!open);
  };

  const { facility, onTogglePause, onPause } = props;
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
  const accentColor = (fuel && fuelColors[fuel]) || storageColor;
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
    >
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={getDraggableStyle(
            snapshot.isDragging,
            provided.draggableProps.style,
          )}
        >
          <ListItem disabled={underConstruction} className="facility">
            <DragIndicatorIcon
              className="draggable-indicator"
              color="primary"
            />
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
                        activity === "CHARGING" ? storageColor : undefined,
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
            <Dialog open={open} onClose={toggleDialog}>
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
            <ListItemSecondaryAction>
              {!underConstruction &&
                props.listLength > 1 &&
                !facility.paused && (
                  <IconButton
                    onClick={() => onPause(facility.id, facility.name)}
                    aria-label={`Pause ${facility.name}`}
                    edge="end"
                    color="primary"
                    size="large"
                  >
                    <PauseIcon />
                  </IconButton>
                )}
              {facility.paused && (
                <IconButton
                  onClick={() => onTogglePause(facility.id)}
                  aria-label={`Resume ${facility.name}`}
                  edge="end"
                  color="primary"
                  size="large"
                >
                  <PlayIcon />
                </IconButton>
              )}
              {!underConstruction && props.listLength > 1 && (
                <IconButton
                  onClick={toggleDialog}
                  aria-label={`Sell ${facility.name}`}
                  edge="end"
                  color="primary"
                  size="large"
                >
                  <DeleteForeverIcon />
                </IconButton>
              )}
              {underConstruction && (
                <IconButton
                  onClick={toggleDialog}
                  aria-label={`Cancel construction of ${facility.name}`}
                  edge="end"
                  color="primary"
                  size="large"
                >
                  <CancelIcon />
                </IconButton>
              )}
            </ListItemSecondaryAction>
          </ListItem>
        </div>
      )}
    </Draggable>
  );
}

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onGeneratorBuild: () => void;
  onSell: (id: FacilityOperatingType["id"]) => void;
  onTogglePause: (id: FacilityOperatingType["id"]) => void;
  onPause: (id: FacilityOperatingType["id"], name: string) => void;
  onReprioritize: (spotInList: number, delta: number) => void;
  onStorageBuild: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Facilities extends React.Component<Props, {}> {
  constructor(props: Props) {
    super(props);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  public shouldComponentUpdate(nextProps: Props) {
    // In fast modes, skip frames so that CPU can focus on simulation
    switch (nextProps.game.speed) {
      case "FAST":
        return (nextProps.game.date.minute / TICK_MINUTES) % 8 === 0;
      default:
        return true;
    }
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
      onStorageBuild,
    } = this.props;
    const facilitiesCount = game.facilities.length;

    return (
      <GameCard>
        <ChartSupplyDemand
          height={180}
          timeline={game.timeline}
          currentMinute={game.date.minute}
          location={game.location}
          legend={game.speed === "PAUSED"}
          startingYear={game.startingYear}
        />
        <List dense className="scrollable">
          <Toolbar style={{ paddingBottom: "4px" }}>
            <Typography variant="h6">Facilities</Typography>
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
          </Toolbar>
          <DragDropContext onDragEnd={this.onDragEnd}>
            <Droppable droppableId="droppable">
              {(provided, snapshot) => (
                <div {...provided.droppableProps} ref={provided.innerRef}>
                  {game.facilities.map(
                    (g: FacilityOperatingType, i: number) => (
                      <FacilityListItem
                        facility={g}
                        key={g.id}
                        onSell={onSell}
                        onTogglePause={onTogglePause}
                        onPause={onPause}
                        onReprioritize={onReprioritize}
                        spotInList={i}
                        listLength={facilitiesCount}
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
              (click "Generator" or "Storage" to build more)
            </Typography>
          )}
        </List>
      </GameCard>
    );
  }
}
