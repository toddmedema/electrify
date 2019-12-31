import {connect} from 'react-redux';
import Redux from 'redux';
import {initWeather} from 'shared/schema/Weather';
import {AppStateType, NewGameAction} from '../../Types';
import Loading, {DispatchProps, StateProps} from './Loading';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    load: () => {
      initWeather('SF', () => {
        // TODO load game state from localstorage if loading

        // Otherwise, generate from scratch
        dispatch({
          type: 'NEW_GAME',
          generators: [{fuel: 'Coal', peakW: 500000000}],
          cash: 200000000,
          regionPopulation: 1080000,
        } as NewGameAction);

        dispatch({type: 'GAME_LOADED'});
      });
    },
  };
};

const LoadingContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Loading);

export default LoadingContainer;
