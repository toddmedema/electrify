import type { AppDispatch } from "../../Store";
import * as React from "react";
import { connect } from "react-redux";
import { IconButton, Menu, MenuItem, Toolbar, Typography } from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import FastForwardIcon from "@mui/icons-material/FastForward";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { formatHour, getTimeFromTimeline } from "../../helpers/DateTime";
import { formatMoneyStable } from "../../helpers/Format";
import { navigate } from "../../reducers/Card";
import { isBigScreen, isSmallScreen, openWindow } from "../../Globals";
import { getNextTutorial } from "../../data/Scenarios";
import { quit, setSpeed, startTutorial } from "../../reducers/Game";
import { AppStateType, GameType, SpeedType } from "../../Types";

/**
 * The game's global state: cash, the date, how fast time is running, how far through the year it
 * is, and whether the lights are currently out.
 *
 * This used to live inside whichever pane happened to be showing, which on desktop meant all of
 * it was reported from the top-left corner of column one. None of it belongs to a single pane,
 * so it spans the app instead -- one bar above the panes on desktop, and the card's own header
 * on a phone, where there is only ever one pane anyway.
 */

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onManual: () => void;
  onSpeedChange: (speed: SpeedType) => void;
  onNextTutorial: (scenarioId: number) => void;
  onQuit: () => void;
}

export interface Props extends StateProps, DispatchProps {}

interface SpeedOptionsProps {
  smallScreen: boolean;
  speed: SpeedType;
  onSpeedChange: (speed: SpeedType) => void;
  speedAnchorEl: HTMLElement | null;
  handleSpeedClick: (event: React.MouseEvent<HTMLElement>) => void;
  handleSpeedClose: () => void;
}

// Pulled out of the component so it can be memoised on the handful of things it actually
// depends on, rather than rebuilt on every tick along with the cash readout beside it
function buildSpeedOptions({
  smallScreen,
  speed,
  onSpeedChange,
  speedAnchorEl,
  handleSpeedClick,
  handleSpeedClose,
}: SpeedOptionsProps): React.JSX.Element {
  if (!smallScreen) {
    return (
      <span>
        <IconButton
          onClick={() => onSpeedChange("PAUSED")}
          disabled={speed === "PAUSED"}
          aria-label="pause"
          edge="end"
          color="primary"
          size="large"
        >
          <PauseIcon />
        </IconButton>
        <IconButton
          onClick={() => onSpeedChange("SLOW")}
          disabled={speed === "SLOW"}
          aria-label="slow speed"
          edge="end"
          color="primary"
          size="large"
        >
          <ChevronRightIcon />
        </IconButton>
        <IconButton
          onClick={() => onSpeedChange("NORMAL")}
          disabled={speed === "NORMAL"}
          aria-label="normal speed"
          edge="end"
          color="primary"
          size="large"
        >
          <PlayArrowIcon />
        </IconButton>
        <IconButton
          onClick={() => onSpeedChange("FAST")}
          disabled={speed === "FAST"}
          aria-label="fast speed"
          edge="end"
          color="primary"
          size="large"
        >
          <FastForwardIcon />
        </IconButton>
      </span>
    );
  }

  let speedIcon = <PlayArrowIcon />;
  switch (speed) {
    case "PAUSED":
      speedIcon = <PlayArrowIcon />;
      break;
    case "SLOW":
      speedIcon = <ChevronRightIcon />;
      break;
    case "NORMAL":
      speedIcon = <PlayArrowIcon />;
      break;
    case "FAST":
      speedIcon = <FastForwardIcon />;
      break;
    default:
      break;
  }
  return (
    <span>
      {speed !== "PAUSED" && (
        <IconButton
          onClick={() => onSpeedChange("PAUSED")}
          aria-label="pause"
          size="large"
        >
          <PauseIcon color="primary" />
        </IconButton>
      )}
      <IconButton
        onClick={handleSpeedClick}
        aria-label="change speed"
        edge="end"
        color="primary"
        size="large"
      >
        {speedIcon}
      </IconButton>
      <Menu
        id="speedMenu"
        anchorEl={speedAnchorEl}
        keepMounted
        open={Boolean(speedAnchorEl)}
        onClose={handleSpeedClose}
      >
        <MenuItem
          onClick={() => {
            onSpeedChange("SLOW");
            handleSpeedClose();
          }}
          disabled={speed === "SLOW"}
          aria-label="slow-speed"
        >
          <ChevronRightIcon color="primary" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            onSpeedChange("NORMAL");
            handleSpeedClose();
          }}
          disabled={speed === "NORMAL"}
          aria-label="normal-speed"
        >
          <PlayArrowIcon color="primary" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            onSpeedChange("FAST");
            handleSpeedClose();
          }}
          disabled={speed === "FAST"}
          aria-label="fast-speed"
        >
          <FastForwardIcon color="primary" />
        </MenuItem>
      </Menu>
    </span>
  );
}

export function GameAppBar(props: Props) {
  const { game, onManual, onNextTutorial, onQuit, onSpeedChange } = props;
  const date = game.date;
  const now = getTimeFromTimeline(date.minute, game.timeline);
  const [menuAnchorEl, setMenuAnchorEl] = React.useState<HTMLElement | null>(
    null,
  );
  const [speedAnchorEl, setSpeedAnchorEl] = React.useState<HTMLElement | null>(
    null,
  );

  const smallScreen = isSmallScreen();
  const bigScreen = isBigScreen();
  const speed = game.speed;
  // Watching somebody else's run rather than playing your own. The speed controls stay live --
  // being able to pause and fast forward is most of the point of a replay
  const isReplay = !!game.replayPlayback;
  // Undefined outside a tutorial, and on the last one - so this doubles as "is there a next
  // tutorial to offer?" for the menu item below. Also undefined throughout a replay, since a
  // tutorial never sets a score and so never has one to watch
  const nextTutorial = getNextTutorial(game.scenarioId);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) =>
    setMenuAnchorEl(event.currentTarget);
  const handleMenuClose = () => setMenuAnchorEl(null);
  const handleSpeedClick = (event: React.MouseEvent<HTMLElement>) =>
    setSpeedAnchorEl(event.currentTarget);
  const handleSpeedClose = () => setSpeedAnchorEl(null);

  /**
   * The bar has to re-render every tick to keep the cash and the clock honest, which at FAST is
   * a hundred times a second. Everything else in it -- five icon buttons and a kept-mounted menu
   * -- only changes when the player clicks something, so those subtrees are built once per actual
   * change and handed back as the same elements. React then skips them entirely on the frames in
   * between, which is where a good quarter of the frame budget went.
   */
  const speedOptions = React.useMemo(
    () =>
      buildSpeedOptions({
        smallScreen,
        speed,
        onSpeedChange,
        speedAnchorEl,
        handleSpeedClick,
        handleSpeedClose,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [smallScreen, speed, onSpeedChange, speedAnchorEl],
  );

  const menu = React.useMemo(
    () => (
      <>
        <IconButton
          onClick={handleMenuClick}
          aria-label="menu"
          edge="start"
          color="primary"
          size="large"
        >
          <MoreVertIcon />
        </IconButton>
        <Menu
          id="gameCardMenu"
          anchorEl={menuAnchorEl}
          keepMounted
          open={Boolean(menuAnchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={onManual}>Manual</MenuItem>
          <MenuItem onClick={() => openWindow("mailto:todd@fabricate.io")}>
            Send feedback
          </MenuItem>
          {/* Mid-tutorial, the thing a player who has seen enough wants is the next tutorial,
              not the scenario list they would have to go back through to reach it */}
          {nextTutorial && (
            <MenuItem onClick={() => onNextTutorial(nextTutorial.id)}>
              Next tutorial
            </MenuItem>
          )}
          <MenuItem onClick={onQuit}>
            {isReplay ? "Exit replay" : "Quit"}
          </MenuItem>
        </Menu>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuAnchorEl, onManual, onNextTutorial, onQuit, nextTutorial, isReplay],
  );

  if (!game.inGame || !now) {
    return <span />;
  }

  const inBlackout = now.supplyW < now.demandW;

  return (
    <div id="appbar">
      <div id="topbar">
        <Toolbar className={inBlackout ? "blackout-pulsing" : ""}>
          {menu}
          <Typography variant="h6">
            {formatMoneyStable(now.cash)}&nbsp;
            <span className="weak">
              {date.month} {date.year}
              {bigScreen ? `, ${formatHour(date)}` : ""}
            </span>
            {isReplay && <span className="replayBadge">REPLAY</span>}
          </Typography>
          <div id="speedChangeButtons">{speedOptions}</div>
        </Toolbar>
      </div>
      <div
        id="yearProgressBar"
        style={{
          width: `${date.percentOfYear * 100}%`,
        }}
      />
    </div>
  );
}

const mapStateToProps = (state: AppStateType): StateProps => ({
  game: state.game,
});

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
    onNextTutorial: (scenarioId: number) => {
      startTutorial(dispatch, scenarioId);
    },
    onQuit: () => {
      dispatch(quit());
    },
  };
};

const GameAppBarContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(GameAppBar);

export default GameAppBarContainer;
