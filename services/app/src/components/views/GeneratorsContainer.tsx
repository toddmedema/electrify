import {connect} from 'react-redux';
import Redux from 'redux';
import {AppState} from '../../Types';
import Generators, {DispatchProps, StateProps} from './Generators';

const mapStateToProps = (state: AppState): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const GeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Generators);

export default GeneratorsContainer;
