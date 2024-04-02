import Redux from 'redux';
import {connect} from 'react-redux';
import {navigateBack, gameStart} from '../../reducers/Card';
import {start, delta} from '../../reducers/Game';
import {authWrapper} from '../../Globals';
import {AppStateType, GameType} from '../../Types';
import NewGameDetails, {DispatchProps, StateProps} from './NewGameDetails';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigateBack());
    },
    onDelta: (d: Partial<GameType>) => {
      dispatch(delta(d));
    },
    onStart: (d: Partial<GameType>) => {
      dispatch(start(d));
      dispatch(gameStart());
    },
  };
};

const NewGameDetailsContainer = authWrapper(connect(
  mapStateToProps,
  mapDispatchToProps
)(NewGameDetails));

export default NewGameDetailsContainer;
