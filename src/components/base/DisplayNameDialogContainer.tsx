import { connect } from "react-redux";
import type { AppDispatch } from "../../Store";
import { claimDisplayName, delta } from "../../reducers/User";
import { snackbarOpen } from "../../reducers/UI";
import { AppStateType } from "../../Types";
import DisplayNameDialog, {
  DispatchProps,
  StateProps,
} from "./DisplayNameDialog";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    open: Boolean(state.user.needsDisplayName),
    currentName: state.user.displayName,
    googleDisplayName: state.user.googleDisplayName,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onSave: async (name: string) => {
      const result = await dispatch(claimDisplayName(name));
      if (claimDisplayName.rejected.match(result)) {
        // rejectWithValue carries the reason the player can act on; anything else means the thunk
        // itself threw, which it is not supposed to
        return result.payload || "Couldn't save that name. Please try again.";
      }
      dispatch(snackbarOpen(`You're on the board as ${result.payload}.`));
      return undefined;
    },
    onClose: () => {
      dispatch(delta({ needsDisplayName: false }));
    },
  };
};

const DisplayNameDialogContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(DisplayNameDialog);

export default DisplayNameDialogContainer;
