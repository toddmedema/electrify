import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppStateType} from '../../Types';
import TutorialBuild, {DispatchProps, StateProps} from './TutorialBuild';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onStart: () => {
      dispatch({type: 'GAME_START'});
    },
    onCancel: () => {
      dispatch(toCard({name: 'MAIN_MENU'}));
    },
  };
};

const TutorialBuildContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(TutorialBuild);

export default TutorialBuildContainer;
