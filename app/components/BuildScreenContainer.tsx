import Redux from 'redux'
import {connect} from 'react-redux'
import {BuildGeneratorAction} from '../actions/ActionTypes'
import {toPage} from '../actions/Navigation'
import {AppState, GeneratorId} from '../reducers/StateTypes'
import BuildScreen, {BuildScreenStateProps, BuildScreenDispatchProps} from './BuildScreen'

declare var window:any;

const mapStateToProps = (state: AppState, ownProps: any): BuildScreenStateProps => {
  return {
    game: state.game,
    navigation: state.navigation,
  };
}

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>, ownProps: any): BuildScreenDispatchProps => {
  return {
    onBuild: (id: GeneratorId) => {
      dispatch({type: 'BUILD_GENERATOR', id} as BuildGeneratorAction);
    },
    onBuildNav: () => {
      dispatch(toPage('BUILD'));
    },
    onGeneratorsNav: () => {
      dispatch(toPage('GENERATORS'));
    },
    onResearchNav: () => {
      dispatch(toPage('RESEARCH'));
    },
    onSimulateNav: () => {
      dispatch(toPage('SIMULATE'));
    },
  };
}

const BuildScreenContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildScreen);

export default BuildScreenContainer
