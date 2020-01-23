import {connect} from 'react-redux';
import Redux from 'redux';
import {toPrevious} from '../../actions/Card';
import {AppStateType} from '../../Types';
import HighScores, {DispatchProps, StateProps} from './HighScores';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(toPrevious());
    },
  };
};

const HighScoresContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(HighScores);

export default HighScoresContainer;
