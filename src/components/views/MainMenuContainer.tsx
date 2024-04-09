import Redux from "redux";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import { navigate } from "../../reducers/Card";
import { change as changeSettings } from "../../reducers/Settings";
import MainMenu, { DispatchProps, StateProps } from "./MainMenu";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    audioEnabled: state.settings.audioEnabled,
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onSettings: () => {
      dispatch(navigate("SETTINGS"));
    },
    onStart: () => {
      dispatch(navigate("NEW_GAME"));
    },
  };
};

const MainMenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(MainMenu);

export default MainMenuContainer;
