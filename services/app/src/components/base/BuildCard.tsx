import IconButton from '@material-ui/core/IconButton';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import PlayCircleFilledIcon from '@material-ui/icons/PlayCircleFilled';
import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';
import {getDateFromMinute} from 'shared/helpers/DateTime';
import {toCard} from '../../actions/Card';
import {TICK_MS} from '../../Constants';
import {AppStateType, GameStateType} from '../../Types';
import Chart from './Chart';

const numbro = require('numbro');

export interface BuildCardProps extends React.Props<any> {
  children?: JSX.Element[] | undefined;
  className?: string | undefined;
  gameState: GameStateType;
}

export interface DispatchProps {
  onPlay: () => any;
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
          <IconButton onClick={props.onPlay} color="primary" aria-label="play" edge="end">
            <PlayCircleFilledIcon />
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
