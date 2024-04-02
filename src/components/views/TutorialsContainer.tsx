import Redux from 'redux';
import {connect} from 'react-redux';
import {start, quit} from '../../reducers/Game';
import {navigate} from '../../reducers/Card';
import {AppStateType, GameType} from '../../Types';
import Tutorials, {DispatchProps, StateProps} from './Tutorials';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(quit());
      dispatch(navigate('MAIN_MENU'));
    },
    onStart: (delta: Partial<GameType>) => {
      dispatch(start(delta));
    },
  };
};

const TutorialsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Tutorials);

export default TutorialsContainer;
