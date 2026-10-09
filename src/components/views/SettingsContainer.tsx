import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate, navigateBack } from "../../reducers/Card";
import { change as changeSettings } from "../../reducers/Settings";
import { delta as userDelta, logout } from "../../reducers/User";
import { login } from "../../Globals";
import {
  AppStateType,
  InterfaceSizeType,
  ThemeChoiceType,
  UnitSystemType,
} from "../../Types";
import Settings, { DispatchProps, StateProps } from "./Settings";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    settings: state.settings,
    loggedIn: Boolean(state.user.uid),
    displayName: state.user.displayName,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onLogin: () => {
      login();
    },
    onLogout: () => {
      dispatch(logout());
    },
    // The dialog itself lives next to the global one in Compositor, so it can also open on first
    // login from whichever card the player happens to be on
    onChangeName: () => {
      dispatch(userDelta({ needsDisplayName: true }));
    },
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onMusicVolumeChange: (v: number) => {
      dispatch(changeSettings({ musicVolume: v }));
    },
    onSoundEffectsVolumeChange: (v: number) => {
      dispatch(changeSettings({ soundEffectsVolume: v }));
    },
    onUnitsChange: (v: UnitSystemType) => {
      dispatch(changeSettings({ units: v }));
    },
    // The palette itself is applied above the store, in App's ThemedApp, which is the only
    // place that can also hear the system changing its mind while the game is open
    onThemeChange: (v: ThemeChoiceType) => {
      dispatch(changeSettings({ theme: v }));
    },
    onInterfaceSizeChange: (v: InterfaceSizeType) => {
      dispatch(changeSettings({ interfaceSize: v }));
    },
    onManageSaves: () => {
      dispatch(navigate("SAVED_GAMES"));
    },
    // Mirrors Manual: Settings can now be reached mid-game too, so back has to return wherever
    // the player came from rather than always dropping them at the main menu
    onBack: () => {
      dispatch(navigateBack());
    },
  };
};

const SettingsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Settings);

export default SettingsContainer;
