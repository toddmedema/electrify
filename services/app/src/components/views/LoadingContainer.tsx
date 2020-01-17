import {connect} from 'react-redux';
import Redux from 'redux';
import {initWeather} from 'shared/schema/Weather';
import {AppStateType, GameStateType, NewGameAction} from '../../Types';
import Loading, {DispatchProps, StateProps} from './Loading';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    load: (gameState: GameStateType) => {
      initWeather('SF', () => {
        // TODO load game state from localstorage if loading

        // Otherwise, generate from scratch
        dispatch({
          type: 'NEW_GAME',
          facilities: [{fuel: 'Coal', peakW: 500000000}],
          cash: 200000000,
          population: 1080000,
        } as NewGameAction);

        dispatch({type: 'GAME_LOADED'});

        if (gameState.inTutorial) {
          setTimeout(() => dispatch({type: 'GAMESTATE_DELTA', delta: {tutorialStep: 0}}), 300);
        }
      });
    },
  };
};

const LoadingContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Loading);

export default LoadingContainer;
