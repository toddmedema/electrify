import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, ReprioritizeFacilityAction, SellFacilityAction} from '../../Types';
import Facilities, {DispatchProps, StateProps} from './Facilities';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onGeneratorBuild: () => {
      dispatch(toCard({name: 'BUILD_GENERATORS', dontRemember: true}));
    },
    onSell: (id: SellFacilityAction['id']) => {
      dispatch({type: 'SELL_FACILITY', id} as SellFacilityAction);
    },
    onReprioritize: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_FACILITY', spotInList, delta} as ReprioritizeFacilityAction);
    },
    onStorageBuild: () => {
      dispatch(toCard({name: 'BUILD_STORAGE', dontRemember: true}));
    },
  };
};

const FacilitiesContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Facilities);

export default FacilitiesContainer;
