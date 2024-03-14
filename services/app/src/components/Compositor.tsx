import {Button, Dialog, DialogActions, DialogContent, DialogTitle, Snackbar, Typography} from '@material-ui/core';
import * as React from 'react';
import { GlobalHotKeys  } from 'react-hotkeys';
import Joyride, { ACTIONS, EVENTS } from 'react-joyride';
import {CSSTransition, TransitionGroup} from 'react-transition-group';

import {CARD_TRANSITION_ANIMATION_MS, NAV_CARDS} from '../Constants';
import {CardNameType, CardType, SettingsType, TransitionClassType, TutorialStepType, UIType} from '../Types';

import AudioContainer from './base/AudioContainer';
import BuildGeneratorsContainer from './views/BuildGeneratorsContainer';
import BuildStorageContainer from './views/BuildStorageContainer';
import CustomGameContainer from './views/CustomGameContainer';
import FacilitiesContainer from './views/FacilitiesContainer';
import FinancesContainer from './views/FinancesContainer';
import ForecastsContainer from './views/ForecastsContainer';
import LoadingContainer from './views/LoadingContainer';
import MainMenuContainer from './views/MainMenuContainer';
import ManualContainer from './views/ManualContainer';
import NewGameContainer from './views/NewGameContainer';
import NewGameDetailsContainer from './views/NewGameDetailsContainer';
import SettingsContainer from './views/SettingsContainer';
import TutorialsContainer from './views/TutorialsContainer';

// TODO move to dispatch (probably move the entire shortcutHandlers function, and have it take in the triggered shortcut name?)
import {toCard} from '../actions/Card';
import {setSpeed} from '../reducers/GameState';
import {getStore} from '../Store';

const keyMap = {
  PAUSED: '`',
  SLOW: '1',
  NORMAL: '2',
  FAST: '3',
  LIGHTNING: '4',
  FACILITIES: 'q',
  FINANCES: 'w',
  FORECASTS: 'e',
};

const shortcutHandlers = {
  PAUSED: () => { getStore().dispatch(setSpeed('PAUSED')); },
  SLOW: () => { getStore().dispatch(setSpeed('SLOW')); },
  NORMAL: () => { getStore().dispatch(setSpeed('NORMAL')); },
  FAST: () => { getStore().dispatch(setSpeed('FAST')); },
  FACILITIES: () => { getStore().dispatch(toCard({name: 'FACILITIES'})); },
  FINANCES: () => { getStore().dispatch(toCard({name: 'FINANCES'})); },
  FORECASTS: () => { getStore().dispatch(toCard({name: 'FORECASTS'})); },
};

interface TooltipProps {
  continuous: any;
  index: any;
  step: any;
  backProps: any;
  closeProps: any;
  primaryProps: any;
  tooltipProps: any;
  isLastStep: boolean;
}

function Tooltip(props: TooltipProps): JSX.Element {
  const {index, step, backProps, primaryProps, tooltipProps, isLastStep} = props;
  const isString = typeof step.content === 'string';
  return <div id="tutorial-tooltip" {...tooltipProps}>
    {step.title && <Typography variant="h6" gutterBottom>{step.title}</Typography>}
    {isString ? <Typography variant="body1">{step.content}</Typography> : step.content}
    <div>
      {index > 0 && (
        <Button {...backProps} color="primary">
          Back
        </Button>
      )}
      <Button {...primaryProps} variant="contained" color="primary">
        {isLastStep ? 'Play' : 'Next'}
      </Button>
    </div>
    <div style={{clear: 'both'}}></div>
  </div>;
}

export interface StateProps {
  card: CardType;
  settings: SettingsType;
  ui: UIType;
  transition: TransitionClassType;
  tutorialStep: number;
  tutorialSteps?: TutorialStepType[];
}

export interface DispatchProps {
  closeDialog: () => void;
  closeSnackbar: () => void;
  onTutorialStep: (newStep: number, tutorialSteps: TutorialStepType[] | undefined) => void;
}

export interface Props extends StateProps, DispatchProps {}

export function isNavCard(name: CardNameType) {
  return NAV_CARDS.indexOf(name) !== -1;
}

export default class Compositor extends React.Component<Props, {}> {
  public handleJoyrideCallback = (data: any) => {
    const { action, index, type } = data;
    if ([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND].includes(type)) {
      this.props.onTutorialStep(index + (action === ACTIONS.PREV ? -1 : 1), this.props.tutorialSteps);
    }
  }

  public snackbarActionClicked(e: React.MouseEvent<HTMLElement>) {
    if (this.props.ui.snackbar.action) {
      this.props.ui.snackbar.action(e);
    }
  }

  private renderCard(): JSX.Element {
    switch (this.props.card.name) {
      case 'BUILD_GENERATORS':
        return <BuildGeneratorsContainer />;
      case 'BUILD_STORAGE':
        return <BuildStorageContainer />;
      case 'FINANCES':
        return <FinancesContainer />;
      case 'FORECASTS':
        return <ForecastsContainer />;
      case 'CUSTOM_GAME':
        return <CustomGameContainer />;
      case 'FACILITIES':
        return <FacilitiesContainer />;
      case 'SETTINGS':
        return <SettingsContainer />;
      case 'MAIN_MENU':
        return <MainMenuContainer />;
      case 'MANUAL':
        return <ManualContainer />;
      case 'LOADING':
        return <LoadingContainer />;
      case 'TUTORIALS':
        return <TutorialsContainer />;
      case 'NEW_GAME':
        return <NewGameContainer />;
      case 'NEW_GAME_DETAILS':
        return <NewGameDetailsContainer />;
      default:
        throw new Error('Unknown card ' + this.props.card.name);
    }
  }

  public shouldComponentUpdate(nextProps: Props) {
    // Update if changing tutorial step
    if (this.props.tutorialStep !== nextProps.tutorialStep) {
      return true;
    }

    // Update if dialog / snackbar changes
    if (this.props.ui.dialog.open !== nextProps.ui.dialog.open || this.props.ui.snackbar.open !== nextProps.ui.snackbar.open) {
      return true;
    }

    // Don't update the main UI if we're on the same card
    if (this.props.card.name === nextProps.card.name) {
      return false;
    }

    return true;
  }

  public render() {
    const { tutorialStep, ui, closeDialog, tutorialSteps, closeSnackbar } = this.props;

    // See https://medium.com/lalilo/dynamic-transitions-with-react-router-and-react-transition-group-69ab795815c9
    // for more details on use of childFactory in TransitionGroup
    return (
      <div className="app_container">
        <GlobalHotKeys keyMap={keyMap} handlers={shortcutHandlers} />
        <TransitionGroup
          childFactory={(child) => React.cloneElement(
              child, {classNames: this.props.transition}
          )}>
          <CSSTransition
            key={this.props.card.name}
            classNames={''}
            timeout={{enter: CARD_TRANSITION_ANIMATION_MS, exit: CARD_TRANSITION_ANIMATION_MS}}>
            <div className="base_main">
              {this.renderCard()}
            </div>
          </CSSTransition>
        </TransitionGroup>
        {tutorialSteps && <Joyride
          callback={this.handleJoyrideCallback}
          continuous={true}
          disableCloseOnEsc={true}
          disableOverlayClose={true}
          showProgress={true}
          run={tutorialStep >= 0}
          tooltipComponent={Tooltip}
          stepIndex={tutorialStep}
          steps={tutorialSteps}
          styles={{
            options: {
              beaconSize: 48,
              overlayColor: 'rgba(0, 0, 0, 0.1)',
            },
          }}
        />}
        <Dialog
          open={ui.dialog.open}
          onClose={closeDialog}
          disableBackdropClick={ui.dialog.notCancellable}
          disableEscapeKeyDown={ui.dialog.notCancellable}
        >
          <DialogTitle>{ui.dialog.title}</DialogTitle>
          <DialogContent>{ui.dialog.message}</DialogContent>
          <DialogActions>
            {!ui.dialog.notCancellable && <Button color="primary" onClick={closeDialog}>
              {ui.dialog.closeText || (ui.dialog.action ? 'Cancel' : 'OK')}
            </Button>}
            {ui.dialog.action && <Button color="primary" variant="contained" onClick={ui.dialog.action}>
              {ui.dialog.actionLabel || 'OK'}
            </Button>}
          </DialogActions>
        </Dialog>
        <Snackbar
          className="snackbar"
          open={ui.snackbar.open}
          message={<span>{ui.snackbar.message}</span>}
          autoHideDuration={ui.snackbar.timeout}
          onClose={closeSnackbar}
          action={(ui.snackbar.actionLabel) ? [<Button key={1} onClick={(e: React.MouseEvent<HTMLElement>) => this.snackbarActionClicked(e)}>{ui.snackbar.actionLabel}</Button>] : []}
        />
        <AudioContainer />
      </div>
    );
  }
}
