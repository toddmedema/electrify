import {connect} from 'react-redux';
import Redux from 'redux';
import {closeSnackbar} from '../actions/Snackbar';
import {AppStateType, TransitionClassType} from '../Types';
import Compositor, {DispatchProps, isNavCard, StateProps} from './Compositor';

const mapStateToProps = (state: AppStateType): StateProps => {
  let transition: TransitionClassType = 'next';
  if (state === undefined || Object.keys(state).length === 0) {
    transition = 'instant';
  } else if (state.card.name === 'MAIN_MENU') {
    transition = 'instant';
  } else if (isNavCard(state.card.name)) {
    transition = 'nav';
  }

  return {
    card: state.card,
    settings: state.settings,
    ui: state.ui,
    transition,
    tutorialStep: state.gameState.tutorialStep,
  };
};

export const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    closeSnackbar(): void {
      dispatch(closeSnackbar());
    },
    onTutorialStep(newStep: number): void {
      dispatch({type: 'GAMESTATE_DELTA', delta: { tutorialStep: newStep }});
    },
  };
};

const CompositorContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Compositor);

export default CompositorContainer;
