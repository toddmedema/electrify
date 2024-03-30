import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';
import {IconButton, Menu, MenuItem, Toolbar, Typography} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FastForwardIcon from '@mui/icons-material/FastForward';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {formatHour, getTimeFromTimeline} from '../../helpers/DateTime';
import {formatMoneyStable} from '../../helpers/Format';
import {navigate} from '../../reducers/Card';
import {isBigScreen, isSmallScreen, openWindow} from '../../Globals';
import {quitGame, setSpeed} from '../../reducers/GameState';
import {AppStateType, GameStateType, SpeedType} from '../../Types';
import NavigationContainer from './NavigationContainer';

export interface GameCardProps extends React.ComponentPropsWithoutRef<any> {
  children?: JSX.Element | JSX.Element[] | undefined;
  className?: string | undefined;
  gameState: GameStateType;
}

export interface DispatchProps {
  onManual: () => void;
  onSpeedChange: (speed: SpeedType) => void;
  onQuit: () => void;
}

export interface Props extends GameCardProps, DispatchProps {}

export function GameCard(props: Props) {
  const {gameState} = props;
  const date = gameState.date;
  const smallScreen = isSmallScreen();
  const bigScreen = isBigScreen();
  const now = getTimeFromTimeline(date.minute, gameState.timeline);
  if (!gameState.inGame || !now) {
    return <span/>;
  }

  // TODO fix state management here
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [menuAnchorEl, setMenuAnchorEl] = React.useState(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [speedAnchorEl, setSpeedAnchorEl] = React.useState(null);
  const handleMenuClick = (event: any) => setMenuAnchorEl(event.currentTarget);
  const handleMenuClose = () => setMenuAnchorEl(null);
  const handleSpeedClick = (event: any) => setSpeedAnchorEl(event.currentTarget);
  const handleSpeedClose = () => setSpeedAnchorEl(null);

  const inBlackout = now && now.supplyW < now.demandW;

  let speedOptions = <span/>;
  if (!smallScreen) {
    speedOptions = <span>
      <IconButton
        onClick={() => props.onSpeedChange('PAUSED')}
        disabled={gameState.speed === 'PAUSED'}
        aria-label="pause"
        edge="end"
        color="primary"
        size="large">
        <PauseIcon />
      </IconButton>
      <IconButton
        onClick={() => props.onSpeedChange('SLOW')}
        disabled={gameState.speed === 'SLOW'}
        aria-label="slow speed"
        edge="end"
        color="primary"
        size="large">
        <ChevronRightIcon />
      </IconButton>
      <IconButton
        onClick={() => props.onSpeedChange('NORMAL')}
        disabled={gameState.speed === 'NORMAL'}
        aria-label="normal speed"
        edge="end"
        color="primary"
        size="large">
        <PlayArrowIcon />
      </IconButton>
      <IconButton
        onClick={() => props.onSpeedChange('FAST')}
        disabled={gameState.speed === 'FAST'}
        aria-label="fast speed"
        edge="end"
        color="primary"
        size="large">
        <FastForwardIcon />
      </IconButton>
    </span>;
  } else {
    let speedIcon = <PlayArrowIcon />;
    switch (props.gameState.speed) {
      case 'PAUSED': speedIcon = <PlayArrowIcon />; break;
      case 'SLOW': speedIcon = <ChevronRightIcon />; break;
      case 'NORMAL': speedIcon = <PlayArrowIcon />; break;
      case 'FAST': speedIcon = <FastForwardIcon />; break;
      default: break;
    }
    speedOptions = <span>
      {gameState.speed !== 'PAUSED' && <IconButton
        onClick={() => props.onSpeedChange('PAUSED') }
        aria-label="pause"
        size="large">
        <PauseIcon color="primary" />
      </IconButton>}
      <IconButton
        onClick={handleSpeedClick}
        aria-label="change speed"
        edge="end"
        color="primary"
        size="large">
        {speedIcon}
      </IconButton>
      <Menu
        id="speedMenu"
        anchorEl={speedAnchorEl}
        keepMounted
        open={Boolean(speedAnchorEl)}
        onClose={handleSpeedClose}
      >
        <MenuItem onClick={() => { props.onSpeedChange('SLOW'); handleSpeedClose(); }} disabled={gameState.speed === 'SLOW'} aria-label="slow-speed">
          <ChevronRightIcon color="primary" />
        </MenuItem>
        <MenuItem onClick={() => { props.onSpeedChange('NORMAL'); handleSpeedClose(); }} disabled={gameState.speed === 'NORMAL'} aria-label="normal-speed">
          <PlayArrowIcon color="primary" />
        </MenuItem>
        <MenuItem onClick={() => { props.onSpeedChange('FAST'); handleSpeedClose(); }} disabled={gameState.speed === 'FAST'} aria-label="fast-speed">
          <FastForwardIcon color="primary" />
        </MenuItem>
      </Menu>
    </span>;
  }

  return (
    <div className={props.className + ' flexContainer'} id="gameCard">
      <div id="topbar">
        <Toolbar className={inBlackout ? 'blackout-pulsing' : ''}>
          <IconButton
            onClick={handleMenuClick}
            aria-label="menu"
            edge="start"
            color="primary"
            size="large">
            <MoreVertIcon />
          </IconButton>
          <Menu
            id="gameCardMenu"
            anchorEl={menuAnchorEl}
            keepMounted
            open={Boolean(menuAnchorEl)}
            onClose={handleMenuClose}
          >
            <MenuItem onClick={props.onManual}>Manual</MenuItem>
            <MenuItem onClick={() => openWindow('mailto:todd@fabricate.io')}>Send feedback</MenuItem>
            <MenuItem onClick={props.onQuit}>Quit</MenuItem>
          </Menu>
          <Typography variant="h6">
            {formatMoneyStable(now.cash)}&nbsp;
            <span className="weak">{date.month} {date.year}{(bigScreen ? `, ${formatHour(date)}` : '')}</span>
          </Typography>
          <div id="speedChangeButtons">{speedOptions}</div>
        </Toolbar>
      </div>
      <div id="yearProgressBar" style={{
        width: `${date.percentOfYear * 100}%`,
      }}/>
      {props.children}
      <NavigationContainer />
    </div>
  );
}

const mapStateToProps = (state: AppStateType, ownProps: Partial<GameCardProps>): GameCardProps => ({
  gameState: state.gameState,
  ...ownProps,
});

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onManual: () => {
      dispatch(navigate('MANUAL'));
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
    onQuit: () => {
      dispatch(quitGame());
      dispatch(navigate('MAIN_MENU'));
    },
  };
};

const GameCardContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(GameCard);

export default GameCardContainer;
