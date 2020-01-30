import {connect} from 'react-redux';
import Redux from 'redux';

import {initFuelPrices} from 'shared/schema/FuelPrices';
import {initWeather} from 'shared/schema/Weather';
import {SCENARIOS} from '../../Scenarios';
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
      const scenario = SCENARIOS.find((s) => s.id === gameState.scenarioId);
      if (!scenario) {
        return alert('Unknown scenario ID');
      }
      initWeather('SF', () => {
        // TODO load game state from localstorage if loading

        initFuelPrices(() => {
          // Otherwise, generate from scratch
          // TODO different scenarios - for example, start with Natural Gas if year is 2000+, otherwise coal
          dispatch({
            type: 'NEW_GAME',
            facilities: scenario.facilities,
            cash: 200000000,
            customers: 1030000,
          } as NewGameAction);

          dispatch({type: 'GAME_LOADED'});

          if (scenario.tutorialSteps) {
            setTimeout(() => dispatch({type: 'GAMESTATE_DELTA', delta: {tutorialStep: 0}}), 300);
          }
        });
      });
    },
  };
};

const LoadingContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Loading);

export default LoadingContainer;
