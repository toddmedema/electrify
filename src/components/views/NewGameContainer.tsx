import Redux from 'redux';
import {connect} from 'react-redux';
import {delta, start, quit} from '../../reducers/Game';
import {navigate} from '../../reducers/Card';
import {AppStateType, GameType} from '../../Types';
import NewGame, {DispatchProps, StateProps} from './NewGame';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(quit());
    },
    onDetails: (d: Partial<GameType>) => {
      dispatch(delta(d));
      dispatch(navigate('NEW_GAME_DETAILS'));
    },
    onTutorial: (delta: Partial<GameType>) => {
      dispatch(start(delta));
    },
  };
};

const NewGameContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(NewGame);

export default NewGameContainer;
