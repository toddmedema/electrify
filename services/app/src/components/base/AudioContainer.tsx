import {connect} from 'react-redux';
import Redux from 'redux';
import {loadAudioFiles} from '../../actions/Audio';
import {changeSettings} from '../../actions/Settings';
import {openSnackbar} from '../../actions/UI';
import {initialAudio} from '../../reducers/Audio';
import {AppStateType} from '../../Types';
import Audio, {DispatchProps, StateProps} from './Audio';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    themeManager: (state.audioData || {}).themeManager || null,
    audio: state.audio || initialAudio,
    enabled: state.settings.audioEnabled,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    disableAudio(): void {
      dispatch(openSnackbar('Audio not supported on this device; disabling.'));
      dispatch(changeSettings({audioEnabled: false}));
    },
    loadAudio() {
      dispatch(loadAudioFiles());
    },
  };
};

const AudioContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Audio);

export default AudioContainer;
