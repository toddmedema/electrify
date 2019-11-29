import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppStateType} from '../../Types';
import MainMenu, {DispatchProps, StateProps} from './MainMenu';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onSettings: () => {
      dispatch(toCard({name: 'SETTINGS'}));
    },
    onStart: () => {
      dispatch(toCard({name: 'SUPPLY'}));
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
