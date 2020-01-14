import {Button, Snackbar, Typography} from '@material-ui/core';
import * as React from 'react';
import Joyride, { ACTIONS, EVENTS } from 'react-joyride';
import {CSSTransition, TransitionGroup} from 'react-transition-group';

import {CARD_TRANSITION_ANIMATION_MS, NAV_CARDS} from '../Constants';
import {CardNameType, CardType, SettingsType, TransitionClassType, UIType} from '../Types';

import AudioContainer from './base/AudioContainer';
import BuildGeneratorsContainer from './views/BuildGeneratorsContainer';
import BuildStorageContainer from './views/BuildStorageContainer';
import FacilitiesContainer from './views/FacilitiesContainer';
import FinancesContainer from './views/FinancesContainer';
import ForecastsContainer from './views/ForecastsContainer';
import GameSetupContainer from './views/GameSetupContainer';
import LoadingContainer from './views/LoadingContainer';
import MainMenuContainer from './views/MainMenuContainer';
import SettingsContainer from './views/SettingsContainer';

const TUTORIAL_STEPS = [
  {
    target: '#topbar',
    content: 'Your goal: Make as much money as possible. You lose if you run out of money!',
  },
  {
    target: '.VictoryContainer',
    content: 'Make money by supplying demand for electricity',
  },
  {
    target: '.button-buildGenerator',
    content: 'Build generators and storage to meet demand (options and prices change as new technologies become available)',
  },
  {
    target: '#speedChangeButton',
    content: 'Control the speed of the game',
  },
  {
    target: '#financesNav',
    content: 'Review your financial progress, net worth, and regional information',
  },
  {
    target: '#forecastsNav',
    content: 'Plan for future demand, weather and technology',
  },
  {
    target: '#topbar',
    content: 'That\'s all it takes - good luck!',
  },
];

interface TooltipProps {
  continuous: any;
  index: any;
  step: any;
  backProps: any;
  closeProps: any;
  primaryProps: any;
  tooltipProps: any;
}

function Tooltip(props: TooltipProps): JSX.Element {
  const {index, step, backProps, primaryProps, tooltipProps} = props;
  return <div id="tutorial-tooltip" {...tooltipProps}>
    {step.title && <Typography variant="h6" gutterBottom>{step.title}</Typography>}
    <Typography variant="body1">{step.content}</Typography>
    <div>
      {index > 0 && (
        <Button {...backProps} color="primary">
          Back
        </Button>
      )}
      <Button {...primaryProps} variant="contained" color="primary">
        {index < TUTORIAL_STEPS.length - 1 ? 'Next' : 'Play'}
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
}

export interface DispatchProps {
  closeSnackbar: () => void;
  onTutorialStep: (newStep: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

export function isNavCard(name: CardNameType) {
  return NAV_CARDS.indexOf(name) !== -1;
}

export default class Compositor extends React.Component<Props, {}> {
  public handleJoyrideCallback = (data: any) => {
    const { action, index, type } = data;
    if ([EVENTS.STEP_AFTER, EVENTS.TARGET_NOT_FOUND].includes(type)) {
      this.props.onTutorialStep(index + (action === ACTIONS.PREV ? -1 : 1));
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
      case 'GAME_SETUP':
        return <GameSetupContainer />;
      case 'FACILITIES':
        return <FacilitiesContainer />;
      case 'SETTINGS':
        return <SettingsContainer />;
      case 'MAIN_MENU':
        return <MainMenuContainer />;
      case 'LOADING':
        return <LoadingContainer />;
      default:
        throw new Error('Unknown card ' + this.props.card.name);
    }
  }

  public shouldComponentUpdate(nextProps: Props) {
    // Explicitly update if changing tutorial step
    if (this.props.tutorialStep !== nextProps.tutorialStep) {
      return true;
    }

    // Don't update the main UI if we're on the same card
    if (this.props.card.name === nextProps.card.name) {
      return false;
    }

    return true;
  }

  public render() {
    const { tutorialStep } = this.props;

    // See https://medium.com/lalilo/dynamic-transitions-with-react-router-and-react-transition-group-69ab795815c9
    // for more details on use of childFactory in TransitionGroup
    return (
      <div className="app_container">
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
        <Joyride
          callback={this.handleJoyrideCallback}
          continuous={true}
          showProgress={true}
          run={tutorialStep >= 0}
          tooltipComponent={Tooltip}
          stepIndex={tutorialStep}
          steps={TUTORIAL_STEPS}
          styles={{
            options: {
              beaconSize: 48,
              overlayColor: 'rgba(0, 0, 0, 0)',
            },
          }}
        />
        <Snackbar
          className="snackbar"
          open={this.props.ui.snackbar.open}
          message={<span>{this.props.ui.snackbar.message}</span>}
          autoHideDuration={this.props.ui.snackbar.timeout}
          onClose={this.props.closeSnackbar}
          action={(this.props.ui.snackbar.actionLabel) ? [<Button key={1} onClick={(e: React.MouseEvent<HTMLElement>) => this.snackbarActionClicked(e)}>{this.props.ui.snackbar.actionLabel}</Button>] : []}
        />
        <AudioContainer />
      </div>
    );
  }
}
