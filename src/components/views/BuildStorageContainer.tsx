import type { AppDispatch } from "../../Store";
import { connectToStore } from "../base/ConnectToStore";
import { navigate } from "../../reducers/Card";
import { purchaseFacility } from "../../helpers/PurchaseFacility";
import { AppStateType, StorageShoppingType, TerritoryId } from "../../Types";
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
    onBuildStorage: (
      facility: StorageShoppingType,
      financed: boolean,
      territoryId?: TerritoryId,
    ) => {
      dispatch(purchaseFacility(facility, financed, territoryId));
    },
  };
};

const BuildStorageContainer = connectToStore(
  mapStateToProps,
  mapDispatchToProps,
)(BuildStorage);

export default BuildStorageContainer;
