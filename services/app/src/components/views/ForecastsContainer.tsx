import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType} from '../../Types';
import Forecasts, {DispatchProps, StateProps} from './Forecasts';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const ForecastsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Forecasts);

export default ForecastsContainer;
