import {Button, IconButton, Menu, MenuItem, Toolbar, Typography} from '@material-ui/core';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import DoubleArrowIcon from '@material-ui/icons/DoubleArrow';
import FastForwardIcon from '@material-ui/icons/FastForward';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import PauseIcon from '@material-ui/icons/Pause';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';

import {getTimeFromTimeline} from 'shared/helpers/DateTime';
import {formatMoneyStable} from 'shared/helpers/Format';
import {toCard} from '../../actions/Card';
import {isSmallScreen, openWindow} from '../../Globals';
import {quitGame, setSpeed} from '../../reducers/GameState';
import {AppStateType, GameStateType, SpeedType} from '../../Types';
import NavigationContainer from './NavigationContainer';

export interface GameCardProps extends React.Props<any> {
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
  const now = getTimeFromTimeline(date.minute, gameState.timeline);
  if (!gameState.inGame || !now) {
    return <Button onClick={props.onQuit}>ERROR! Click here to return to the menu</Button>;
  }

  const [menuAnchorEl, setMenuAnchorEl] = React.useState(null);
  const [speedAnchorEl, setSpeedAnchorEl] = React.useState(null);
  const handleMenuClick = (event: any) => setMenuAnchorEl(event.currentTarget);
  const handleMenuClose = () => setMenuAnchorEl(null);
  const handleSpeedClick = (event: any) => setSpeedAnchorEl(event.currentTarget);
  const handleSpeedClose = () => setSpeedAnchorEl(null);

  const inBlackout = now && now.supplyW < now.demandW;

  let speedOptions = <span/>;
  if (!isSmallScreen()) {
    speedOptions = <span>
      <IconButton onClick={() => props.onSpeedChange('PAUSED')} disabled={gameState.speed === 'PAUSED'} aria-label="pause" edge="end" color="primary">
        <PauseIcon />
      </IconButton>
      <IconButton onClick={() => props.onSpeedChange('SLOW')} disabled={gameState.speed === 'SLOW'} aria-label="slow speed" edge="end" color="primary">
        <ChevronRightIcon />
      </IconButton>
      <IconButton onClick={() => props.onSpeedChange('NORMAL')} disabled={gameState.speed === 'NORMAL'} aria-label="normal speed" edge="end" color="primary">
        <PlayArrowIcon />
      </IconButton>
      <IconButton onClick={() => props.onSpeedChange('FAST')} disabled={gameState.speed === 'FAST'} aria-label="fast speed" edge="end" color="primary">
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
      case 'LIGHTNING': speedIcon = <DoubleArrowIcon />; break;
      default: break;
    }
    speedOptions = <span>
      {gameState.speed !== 'PAUSED' && <IconButton onClick={() => props.onSpeedChange('PAUSED') } aria-label="pause">
        <PauseIcon color="primary" />
      </IconButton>}
      <IconButton onClick={handleSpeedClick} aria-label="change speed" edge="end" color="primary">
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

  // TODO only add this back when it's clearly faster... aka probably a lot of optimization on game tick loop
  // (user feedback is that going faster is not super important right now)
  // <MenuItem onClick={() => { props.onSpeedChange('LIGHTNING'); handleSpeedClose(); }} disabled={gameState.speed === 'LIGHTNING'} aria-label="lightning-speed">
  //   <DoubleArrowIcon color="primary" />
  // </MenuItem>

  return (
    <div className={props.className + ' flexContainer'} id="gameCard">
      <div id="topbar">
        <Toolbar className={inBlackout ? 'blackout-pulsing' : ''}>
          <IconButton onClick={handleMenuClick} aria-label="menu" edge="start" color="primary">
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
            {formatMoneyStable(now.cash)} <span className="weak">{date.month} {date.year}</span>
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
      dispatch(toCard({name: 'MANUAL'}));
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
    onQuit: () => {
      dispatch(quitGame());
    },
  };
};

const GameCardContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(GameCard);

export default GameCardContainer;
