import type { AppDispatch, RootState } from "../../Store";
import { connect } from "react-redux";
import { navigateBack } from "../../reducers/Card";
import Manual, { DispatchProps, StateProps } from "./Manual";

const mapStateToProps = (state: RootState): StateProps => {
  return {
    focusEntry: state.card.entry,
  };
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
