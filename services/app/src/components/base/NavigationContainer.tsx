import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppStateType, CardNameType} from '../../Types';
import Navigation, {DispatchProps, Props, StateProps} from './Navigation';

const mapStateToProps = (state: AppStateType, ownProps: Partial<Props>): StateProps => {
  return {
    card: state.card,
    settings: state.settings,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    toCard: (name: CardNameType) => {
      dispatch(toCard({name}));
    },
  };
};

const NavigationContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Navigation);

export default NavigationContainer;
