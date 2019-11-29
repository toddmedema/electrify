import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {changeSettings} from '../../actions/Settings';
import {AppStateType, DifficultyType} from '../../Types';
import Settings, {DispatchProps, StateProps} from './Settings';

const mapStateToProps = (state: AppStateType): StateProps => {
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
    onMainMenu: () => {
      dispatch(toCard({name: 'MAIN_MENU'}));
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
