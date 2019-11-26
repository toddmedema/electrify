import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppState} from '../../reducers/StateTypes';
import QuestListCard, {DispatchProps, StateProps} from '../base/QuestListCard';

const mapStateToProps = (state: AppState): StateProps => {
  return {
    title: 'tutorials',
    icon: 'helper',
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onReturn(): void {
      dispatch(toCard({name: 'SPLASH_CARD'}));
    },
  };
};

const TutorialsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(QuestListCard);

export default TutorialsContainer;
