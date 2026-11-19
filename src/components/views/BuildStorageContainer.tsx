import type { AppDispatch } from "../../Store";
import { connectToStore } from "../base/ConnectToStore";
import { navigate } from "../../reducers/Card";
import {
  purchaseFacility,
  type FacilityPurchaseResult,
} from "../../helpers/PurchaseFacility";
import {
  AppStateType,
  StorageShoppingType,
  TerritoryId,
  TerritoryTileId,
} from "../../Types";
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
      tileId?: TerritoryTileId,
    ): Promise<FacilityPurchaseResult> =>
      dispatch(purchaseFacility(facility, financed, territoryId, tileId)),
  };
};

const BuildStorageContainer = connectToStore(
  mapStateToProps,
  mapDispatchToProps,
)(BuildStorage);

export default BuildStorageContainer;
