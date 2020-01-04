import IconButton from '@material-ui/core/IconButton';
import Menu from '@material-ui/core/Menu';
import MenuItem from '@material-ui/core/MenuItem';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import FastForwardIcon from '@material-ui/icons/FastForward';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import PauseIcon from '@material-ui/icons/Pause';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';

import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';
import {formatMoneyStable} from 'shared/helpers/Format';
import {openWindow} from '../../Globals';
import {quitGame, setSpeed} from '../../reducers/GameState';
import {AppStateType, DateType, GameStateType, SpeedType, TimelineType} from '../../Types';
import NavigationContainer from './NavigationContainer';

export interface GameCardProps extends React.Props<any> {
  children?: JSX.Element[] | undefined;
  className?: string | undefined;
  gameState: GameStateType;
  cash: number;
  date: DateType;
}

export interface DispatchProps {
  onSpeedChange: (speed: SpeedType) => void;
  onQuit: () => void;
}

export interface Props extends GameCardProps, DispatchProps {}

export function GameCard(props: Props) {
  const {gameState, date} = props;
  if (!gameState.inGame) {
    return <span/>;
  }

  const [menuAnchorEl, setMenuAnchorEl] = React.useState(null);
  const [speedAnchorEl, setSpeedAnchorEl] = React.useState(null);
  const handleMenuClick = (event: any) => setMenuAnchorEl(event.currentTarget);
  const handleMenuClose = () => setMenuAnchorEl(null);
  const handleSpeedClick = (event: any) => setSpeedAnchorEl(event.currentTarget);
  const handleSpeedClose = () => setSpeedAnchorEl(null);
  let speedIcon = <PlayArrowIcon />;
  switch (props.gameState.speed) {
    case 'PAUSED': speedIcon = <PauseIcon />; break;
    case 'SLOW': speedIcon = <ChevronRightIcon />; break;
    case 'NORMAL': speedIcon = <PlayArrowIcon />; break;
    case 'FAST': speedIcon = <FastForwardIcon />; break;
    default: break;
  }

  // TODO perf this is a linear lookup every frame, ouch!
  const now = gameState.timeline.find((t: TimelineType) => t.minute >= gameState.date.minute);
  const inBlackout = now && now.supplyW < now.demandW;

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
            <MenuItem onClick={() => openWindow('mailto:todd@fabricate.io')}>Send feedback</MenuItem>
            <MenuItem onClick={props.onQuit}>Quit</MenuItem>
          </Menu>
          <Typography variant="h6">
            <span className="weak">{date.month} {date.year}</span>
            &nbsp;({formatMoneyStable(props.cash)})
          </Typography>
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
        </Toolbar>
        <div id="yearProgressBar" style={{
          width: `${date.percentOfYear * 100}%`,
        }}/>
      </div>
      {props.children}
      <NavigationContainer />
    </div >
  );
}

const mapStateToProps = (state: AppStateType, ownProps: Partial<GameCardProps>): GameCardProps => ({
  gameState: state.gameState,
  date: state.gameState.date,
  cash: (state.gameState.monthlyHistory[0] || {}).cash,
  ...ownProps,
});

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
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