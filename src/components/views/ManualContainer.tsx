import { restoreMenuFocus } from "../base/useMenuKeys";
import type { AppDispatch, RootState } from "../../Store";
import { connect } from "react-redux";
import {
  manualTrailCleared,
  navigate,
  navigateBack,
} from "../../reducers/Card";
import Manual, { DispatchProps, StateProps } from "./Manual";

const mapStateToProps = (state: RootState): StateProps => {
  return {
    focusEntry: state.card.entry,
    focusKey: state.card.ts,
  };
};

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(manualTrailCleared());
      dispatch(navigateBack());
      restoreMenuFocus("[data-manual-trigger]");
    },
    onFollowLink: (to, from) => {
      dispatch(navigate({ name: "MANUAL", entry: to, fromEntry: from }));
    },
  };
};

const ManualContainer = connect(mapStateToProps, mapDispatchToProps)(Manual);

export default ManualContainer;
