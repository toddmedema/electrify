import IconButton from '@material-ui/core/IconButton';
import { makeStyles } from '@material-ui/core/styles';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import PlayCircleFilledIcon from '@material-ui/icons/PlayCircleFilled';
import * as React from 'react';
import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppState, GameStateType} from '../../Types';

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

const useStyles = makeStyles((theme) => ({
  title: {
    flexGrow: 1,
  },
}));

export function BuildCard(props: Props) {
  const classes = useStyles();

  return (
    <div className={props.className} id="buildCard">
      <div id="topbar">
        <Toolbar>
          <Typography variant="h6" className={classes.title}>
            {props.gameState.season}
            <span className="weak"> ({props.gameState.turn}/{props.gameState.turnMax})</span>
            &nbsp;&nbsp;&nbsp;${numbro(props.gameState.finances.cash).format({ average: true, totalLength: 3 }).toUpperCase()}
          </Typography>
          <IconButton onClick={props.onPlay} color="primary" aria-label="play" edge="end">
            <PlayCircleFilledIcon />
          </IconButton>
        </Toolbar>
      </div>
      Chart
      {props.children}
    </div >
  );
}

const mapStateToProps = (state: AppState, ownProps: Partial<BuildCardProps>): BuildCardProps => ({
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
