import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppState} from '../../Types';
import MainMenu, {DispatchProps, StateProps} from './MainMenu';

const mapStateToProps = (state: AppState): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onSettings: () => {
      dispatch(toCard({name: 'SETTINGS'}));
    },
    onStart: () => {
      dispatch(toCard({name: 'GENERATORS'}));
    },
    onTutorial: () => {
      dispatch(toCard({name: 'TUTORIAL'}));
    },
  };
};

const MainMenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(MainMenu);

export default MainMenuContainer;
