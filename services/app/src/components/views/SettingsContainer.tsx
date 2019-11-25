import {connect} from 'react-redux';
import Redux from 'redux';
import {changeSettings} from '../../actions/Settings';
import {AppState, DifficultyType} from '../../reducers/StateTypes';
import Settings, {DispatchProps, fontSizeValues, StateProps} from './Settings';

const mapStateToProps = (state: AppState): StateProps => {
  return {
    settings: state.settings,
  };
};

/* tslint:disable */
const difficultyAdd: any = {
  EASY: 'NORMAL',
  NORMAL: 'HARD',
  HARD: 'IMPOSSIBLE',
  IMPOSSIBLE: 'EASY',
};

const difficultySub: any = {
  EASY: 'IMPOSSIBLE',
  NORMAL: 'EASY',
  HARD: 'NORMAL',
  IMPOSSIBLE: 'HARD',
};
/* tslint:enable */

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({audioEnabled: v}));
    },
    onDifficultyDelta: (difficulty: DifficultyType, i: number) => {
      if (i > 0) {
        difficulty = difficultyAdd[difficulty];
      } else {
        difficulty = difficultySub[difficulty];
      }
      dispatch(changeSettings({difficulty}));
    },
    onExperimentalChange: (v: boolean) => {
      dispatch(changeSettings({experimental: v}));
    },
    onFontSizeDelta: (idx: number, delta: number) => {
      let i = idx + delta;
      if (i >= fontSizeValues.length) {
        i = 0;
      } else if (i < 0) {
        i = fontSizeValues.length - 1;
      }
      dispatch(changeSettings({fontSize: fontSizeValues[i]}));
    },
    onShowHelpChange: (v: boolean) => {
      dispatch(changeSettings({showHelp: v}));
    },
    onVibrationChange: (v: boolean) => {
      dispatch(changeSettings({vibration: v}));
    },
  };
};

const SettingsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Settings);

export default SettingsContainer;
