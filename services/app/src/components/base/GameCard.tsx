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
import {quitGame, setSpeed} from '../../reducers/GameState';
import {AppStateType, DateType, GameStateType, SpeedType} from '../../Types';
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
  if (!props.gameState.inGame) {
    return <span/>;
  }

  const [anchorEl, setAnchorEl] = React.useState(null);

  const handleClick = (event: any) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <div className={props.className} id="gameCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={handleClick} aria-label="menu" edge="start" color="primary">
            <MoreVertIcon />
          </IconButton>
          <Menu
            id="gameCardMenu"
            anchorEl={anchorEl}
            keepMounted
            open={Boolean(anchorEl)}
            onClose={handleClose}
          >
            <MenuItem onClick={props.onQuit}>Quit</MenuItem>
          </Menu>
          <Typography variant="h6">
            <span className="weak">{props.date.month} {props.date.year}</span>
            &nbsp;({formatMoneyStable(props.cash)})
          </Typography>
          <IconButton onClick={() => props.onSpeedChange('PAUSED')} disabled={props.gameState.speed === 'PAUSED'} aria-label="pause" edge="end" color="primary">
            <PauseIcon />
          </IconButton>
          <IconButton onClick={() => props.onSpeedChange('SLOW')} disabled={props.gameState.speed === 'SLOW'} aria-label="slow-speed" edge="end" color="primary">
            <ChevronRightIcon />
          </IconButton>
          <IconButton onClick={() => props.onSpeedChange('NORMAL')} disabled={props.gameState.speed === 'NORMAL'} aria-label="normal-speed" edge="end" color="primary">
            <PlayArrowIcon />
          </IconButton>
          <IconButton onClick={() => props.onSpeedChange('FAST')} disabled={props.gameState.speed === 'FAST'} aria-label="fast-speed" edge="end" color="primary">
            <FastForwardIcon />
          </IconButton>
        </Toolbar>
        <div id="yearProgressBar" style={{
          width: `${props.date.percentOfYear * 100}%`,
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
