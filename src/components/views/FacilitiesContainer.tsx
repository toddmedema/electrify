import Redux from 'redux';
import {connect} from 'react-redux';
import {navigate} from '../../reducers/Card';
import { sellFacility, reprioritizeFacility } from '../../reducers/Game';
import {AppStateType } from '../../Types';
import Facilities, {DispatchProps, StateProps} from './Facilities';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onGeneratorBuild: () => {
      dispatch(navigate({name: 'BUILD_GENERATORS', dontRemember: true}));
    },
    onSell: (id) => {
      dispatch(sellFacility(id));
    },
    onReprioritize: (spotInList: number, delta: number) => {
      dispatch(reprioritizeFacility({spotInList, delta}));
    },
    onStorageBuild: () => {
      dispatch(navigate({name: 'BUILD_STORAGE', dontRemember: true}));
    },
  };
};

const FacilitiesContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Facilities);

export default FacilitiesContainer;
