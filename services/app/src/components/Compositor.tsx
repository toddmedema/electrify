import Button from '@material-ui/core/Button';
import Snackbar from '@material-ui/core/Snackbar';
import * as React from 'react';
import {CSSTransition, TransitionGroup} from 'react-transition-group';

import {CARD_TRANSITION_ANIMATION_MS, NAV_CARDS} from '../Constants';
import {
  CardNameType,
  CardType,
  SettingsType,
  TransitionClassType,
  UIType
} from '../Types';

import AudioContainer from './base/AudioContainer';
import NavigationContainer from './base/NavigationContainer';
import DemandContainer from './views/DemandContainer';
import FinancesContainer from './views/FinancesContainer';
import MainMenuContainer from './views/MainMenuContainer';
import SettingsContainer from './views/SettingsContainer';
import SimulateContainer from './views/SimulateContainer';
import SupplyContainer from './views/SupplyContainer';
import TutorialBuildContainer from './views/TutorialBuildContainer';

export interface StateProps {
  card: CardType;
  settings: SettingsType;
  ui: UIType;
  transition: TransitionClassType;
}

export interface DispatchProps {
  closeSnackbar: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export function isNavCard(name: CardNameType) {
  return NAV_CARDS.indexOf(name) !== -1;
}

export default class Compositor extends React.Component<Props, {}> {

  public snackbarActionClicked(e: React.MouseEvent<HTMLElement>) {
    if (this.props.ui.snackbar.action) {
      this.props.ui.snackbar.action(e);
    }
  }

  private renderCard(): JSX.Element {
    switch (this.props.card.name) {
      case 'DEMAND':
        return <DemandContainer />;
      case 'FINANCES':
        return <FinancesContainer />;
      case 'SUPPLY':
        return <SupplyContainer />;
      case 'TUTORIAL':
        return <TutorialBuildContainer />;
      case 'SETTINGS':
        return <SettingsContainer />;
      case 'SIMULATE':
        return <SimulateContainer />;
      case 'MAIN_MENU':
        return <MainMenuContainer />;
      default:
        throw new Error('Unknown card ' + this.props.card.name);
    }
  }

  private renderFooter(): JSX.Element|null {
    if (isNavCard(this.props.card.name)) {
      return <NavigationContainer />;
    }
    return null;
  }

  public shouldComponentUpdate(nextProps: Props) {
    // Don't update the main UI if we're on the same card
    if (this.props.card.name === nextProps.card.name) {
      return false;
    }

    return true;
  }

  public render() {
    const containerClass = ['app_container'];
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
            key={this.props.card.name}
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
