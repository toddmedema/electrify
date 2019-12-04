import IconButton from '@material-ui/core/IconButton';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import PlayCircleFilledIcon from '@material-ui/icons/PlayCircleFilled';
import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {getSunrise, getSunset} from '../../reducers/GameState';
import {AppStateType, GameStateType} from '../../Types';
import Chart from './Chart';

const numbro = require('numbro');

export interface BuildCardProps extends React.Props<any> {
  children?: JSX.Element[] | undefined;
  className?: string | undefined;
  gameState: GameStateType;
  sunrise: number;
  sunset: number;
}

export interface DispatchProps {
  onPlay: () => any;
}

export interface Props extends BuildCardProps, DispatchProps {}

export function BuildCard(props: Props) {
  return (
    <div className={props.className} id="buildCard">
      <div id="topbar">
        <Toolbar>
          <Typography variant="h6">
            {props.gameState.season}
            <span className="weak"> {props.gameState.year}</span>
            &nbsp;&nbsp;&nbsp;${numbro(props.gameState.cash).format({ average: true, totalLength: 3 }).toUpperCase()}
          </Typography>
          <IconButton onClick={props.onPlay} color="primary" aria-label="play" edge="end">
            <PlayCircleFilledIcon />
          </IconButton>
        </Toolbar>
      </div>
      <Chart
        height={180}
        sunrise={props.sunrise}
        sunset={props.sunset}
        timeline={props.gameState.timeline}
      />
      {props.children}
    </div >
  );
}

const mapStateToProps = (state: AppStateType, ownProps: Partial<BuildCardProps>): BuildCardProps => ({
  gameState: state.gameState,
  sunrise: getSunrise(state),
  sunset: getSunset(state),
  ...ownProps,
});

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onPlay: () => {
      dispatch(toCard({name: 'SIMULATE'}));
    },
  };
};

const BuildCardContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildCard);

export default BuildCardContainer;
