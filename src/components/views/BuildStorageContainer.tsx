import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import { purchaseFacility } from "../../helpers/PurchaseFacility";
import { AppStateType, StorageShoppingType } from "../../Types";
import BuildStorage, { DispatchProps, StateProps } from "./BuildStorage";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigate("FACILITIES"));
    },
    onBuildStorage: (facility: StorageShoppingType, financed: boolean) => {
      dispatch(purchaseFacility(facility, financed));
    },
  };
};

const BuildStorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(BuildStorage);

export default BuildStorageContainer;
