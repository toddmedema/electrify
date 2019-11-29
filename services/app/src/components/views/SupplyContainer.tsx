import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType} from '../../Types';
import Supply, {DispatchProps, StateProps} from './Supply';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuildGenerator: () => {
      dispatch({type: 'BUILD_GENERATOR'});
    },
  };
};

const SupplyContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Supply);

export default SupplyContainer;
