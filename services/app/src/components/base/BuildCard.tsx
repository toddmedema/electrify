import IconButton from '@material-ui/core/IconButton';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import FastForwardIcon from '@material-ui/icons/FastForward';
import PauseIcon from '@material-ui/icons/Pause';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {TICK_MS} from '../../Constants';
import {setSpeed} from '../../reducers/GameState';
import {AppStateType, GameStateType, SpeedType} from '../../Types';
import Chart from './Chart';

const numbro = require('numbro');

export interface BuildCardProps extends React.Props<any> {
  children?: JSX.Element[] | undefined;
  className?: string | undefined;
  gameState: GameStateType;
}

export interface DispatchProps {
  onSpeedChange: (speed: SpeedType) => void;
}

export interface Props extends BuildCardProps, DispatchProps {}

export function BuildCard(props: Props) {
  const date = getDateFromMinute(props.gameState.currentMinute);
  return (
    <div className={props.className} id="buildCard">
      <div id="topbar">
        <Toolbar>
          <Typography variant="h6">
            {date.month}
            <span className="weak"> {date.year}</span>
            &nbsp;&nbsp;&nbsp;${numbro(props.gameState.cash).format({ average: true, totalLength: 3 }).toUpperCase()}
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
        <div id="yearProgressBar" style={{width: `${date.percentOfYear * 100}%`, transition: `width ${TICK_MS / 1000}s linear`}}/>
      </div>
      <Chart
        height={180}
        timeline={props.gameState.timeline}
      />
      {props.children}
    </div >
  );
}

const mapStateToProps = (state: AppStateType, ownProps: Partial<BuildCardProps>): BuildCardProps => ({
  gameState: state.gameState,
  ...ownProps,
});

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
  };
};

const BuildCardContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildCard);

export default BuildCardContainer;
