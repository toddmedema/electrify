import Redux from "redux";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import { change as changeSettings } from "../../reducers/Settings";
import { AppStateType } from "../../Types";
import Settings, { DispatchProps, StateProps } from "./Settings";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    settings: state.settings,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onBack: () => {
      dispatch(navigate("MAIN_MENU"));
    },
  };
};

const SettingsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Settings);

export default SettingsContainer;
