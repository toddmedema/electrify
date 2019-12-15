import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, GeneratorType} from '../../Types';
import Supply, {DispatchProps, StateProps} from './Supply';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    generators: state.gameState.generators,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuildGenerator: (generator: GeneratorType) => {
      dispatch({type: 'BUILD_GENERATOR', generator});
    },
  };
};

const SupplyContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Supply);

export default SupplyContainer;
