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
import {formatMoneyStable} from 'shared/helpers/Format';
import {setSpeed} from '../../reducers/GameState';
import {AppStateType, DateType, GameStateType, SpeedType} from '../../Types';
import Chart from './Chart';
import NavigationContainer from './NavigationContainer';

export interface BuildCardProps extends React.Props<any> {
  children?: JSX.Element[] | undefined;
  className?: string | undefined;
  gameState: GameStateType;
  cash: number;
  date: DateType;
}

export interface DispatchProps {
  onSpeedChange: (speed: SpeedType) => void;
}

export interface Props extends BuildCardProps, DispatchProps {}

export function BuildCard(props: Props) {
  return (
    <div className={props.className} id="buildCard">
      <div id="topbar">
        <Toolbar>
          <Typography variant="h6">
            {props.date.month}
            <span className="weak"> {props.date.year}</span>
            &nbsp;&nbsp;&nbsp;{formatMoneyStable(props.cash)}
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
      <Chart
        height={180}
        timeline={props.gameState.timeline}
        currentMinute={props.date.minute}
      />
      {props.children}
      <NavigationContainer />
    </div >
  );
}

const mapStateToProps = (state: AppStateType, ownProps: Partial<BuildCardProps>): BuildCardProps => ({
  gameState: state.gameState,
  date: state.gameState.date,
  cash: state.gameState.monthlyHistory[0].cash,
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
