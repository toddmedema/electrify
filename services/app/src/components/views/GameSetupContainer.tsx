import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType} from '../../Types';
import GameSetup, {DispatchProps, StateProps} from './GameSetup';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onStart: () => {
      dispatch({type: 'GAME_START'});
    },
  };
};

const GameSetupContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(GameSetup);

export default GameSetupContainer;
