import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigateBack } from "../../reducers/Card";
import { AppStateType } from "../../Types";
import Manual, { DispatchProps, StateProps } from "./Manual";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {};
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigateBack());
    },
  };
};

const ManualContainer = connect(mapStateToProps, mapDispatchToProps)(Manual);

export default ManualContainer;
