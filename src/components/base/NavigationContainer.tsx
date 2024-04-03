import {connect} from 'react-redux';
import {AppStateType} from '../../Types';
import Navigation, {Props, StateProps} from './Navigation';

const mapStateToProps = (state: AppStateType, ownProps: Partial<Props>): StateProps => {
  return {
    card: state.card,
  };
};

const NavigationContainer = connect(
  mapStateToProps
)(Navigation);

export default NavigationContainer;
