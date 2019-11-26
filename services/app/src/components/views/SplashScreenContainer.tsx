import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppState} from '../../reducers/StateTypes';
import SplashScreen, {DispatchProps, StateProps} from './SplashScreen';

const mapStateToProps = (state: AppState): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onStart: () => {
      console.log('foo');
      dispatch(toCard({name: 'TUTORIAL_QUESTS'}));
    },
  };
};

const SplashScreenContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(SplashScreen);

export default SplashScreenContainer;
