import Button from '@material-ui/core/Button';
import Snackbar from '@material-ui/core/Snackbar';
import * as React from 'react';
import {CSSTransition, TransitionGroup} from 'react-transition-group';
import {CARD_TRANSITION_ANIMATION_MS, NAV_CARDS} from '../Constants';
import {
  CardName,
  CardState,
  SettingsType,
  SnackbarState,
  TransitionClassType
} from '../reducers/StateTypes';
import AudioContainer from './base/AudioContainer';
import NavigationContainer from './base/NavigationContainer';
import SettingsContainer from './views/SettingsContainer';
import SplashScreenContainer from './views/SplashScreenContainer';
import TutorialsContainer from './views/TutorialsContainer';

export interface StateProps {
  card: CardState;
  settings: SettingsType;
  snackbar: SnackbarState;
  transition: TransitionClassType;
}

export interface DispatchProps {
  closeSnackbar: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export function isNavCard(name: CardName) {
  for (const n of NAV_CARDS) {
    if (name === n) {
      return true;
    }
  }
  return false;
}

export default class Compositor extends React.Component<Props, {}> {

  public snackbarActionClicked(e: React.MouseEvent<HTMLElement>) {
    if (this.props.snackbar.action) {
      this.props.snackbar.action(e);
    }
  }

  private renderCard(): JSX.Element {
    switch (this.props.card.name) {
      case 'SPLASH_CARD':
        return <SplashScreenContainer />;
      case 'TUTORIAL_QUESTS':
        return <TutorialsContainer />;
      case 'SETTINGS':
        return <SettingsContainer />;
      default:
        throw new Error('Unknown card ' + this.props.card.name);
    }
  }

  private renderFooter(): JSX.Element|null {
    // Show no footers for certain cards
    for (const noShow of ['SPLASH_CARD', 'PLAYER_COUNT_SETTING']) {
      if (this.props.card.name === noShow) {
        return null;
      }
    }

    // Only show nav footer for certain cards
    if (isNavCard(this.props.card.name)) {
      return <NavigationContainer />;
    }
    return null;
  }

  public shouldComponentUpdate(nextProps: Props) {
    // Don't update the main UI if we're on the same card key
    if (this.props.card.key === nextProps.card.key) {
      return false;
    }

    return true;
  }

  public render() {

    const containerClass = ['app_container'];
    if (this.props.settings.fontSize === 'SMALL') {
      containerClass.push('smallFont');
    } else if (this.props.settings.fontSize === 'LARGE') {
      containerClass.push('largeFont');
    }

    const footer = this.renderFooter();

    // See https://medium.com/lalilo/dynamic-transitions-with-react-router-and-react-transition-group-69ab795815c9
    // for more details on use of childFactory in TransitionGroup
    return (
      <div className={containerClass.join(' ')}>
        <TransitionGroup
          childFactory={(child) => React.cloneElement(
              child, {classNames: this.props.transition}
          )}>
          <CSSTransition
            key={this.props.card.key}
            classNames={''}
            timeout={{enter: CARD_TRANSITION_ANIMATION_MS, exit: CARD_TRANSITION_ANIMATION_MS}}>
            <div className={'base_main' + ((footer !== null) ? ' has_footer' : '')}>
              {this.renderCard()}
            </div>
          </CSSTransition>
        </TransitionGroup>
        {footer}
        <Snackbar
          className="snackbar"
          open={this.props.snackbar.open}
          message={<span>{this.props.snackbar.message}</span>}
          autoHideDuration={this.props.snackbar.timeout}
          onClose={this.props.closeSnackbar}
          action={(this.props.snackbar.actionLabel) ? [<Button key={1} onClick={(e: React.MouseEvent<HTMLElement>) => this.snackbarActionClicked(e)}>{this.props.snackbar.actionLabel}</Button>] : []}
        />
        <AudioContainer />
      </div>
    );
  }
}
