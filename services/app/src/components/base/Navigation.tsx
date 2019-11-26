import BottomNavigation from '@material-ui/core/BottomNavigation';
import BottomNavigationAction from '@material-ui/core/BottomNavigationAction';
import * as React from 'react';
import {CardName, CardState, SettingsType} from '../../reducers/StateTypes';

export interface StateProps {
  card: CardState;
  settings: SettingsType;
}

export interface DispatchProps {
  toCard: (name: CardName, settings: SettingsType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Navigation extends React.Component<Props, {}> {

  private computeValue() {
    switch (this.props.card.name) {
      case 'TUTORIAL_QUESTS':
        return this.props.card.name;
      default:
        console.error('Unknown navigation state for card name ' + this.props.card.name);
        return 'TUTORIAL_CARD';
    }
  }

  private genIcon(name: string): JSX.Element {
    return <img className="inline_icon" src={'images/' + name + '.svg'} />;
  }

  public render() {
    // TODO Rename Tools to GM once stretch goal achieved.
    return (
      <BottomNavigation
        id="navfooter"
        value={this.computeValue()}
        showLabels={false}
        onChange={(e: any, name: CardName) => this.props.toCard(name, this.props.settings)}
        className={`nav_footer`}>
        <BottomNavigationAction classes={{label: 'navlabel'}} id="tutorials" label="Tutorial" value="TUTORIAL_QUESTS" icon={this.genIcon('helper')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="offline" label="Offline" value="SAVED_QUESTS" icon={this.genIcon('offline')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="search" label="Quests" value="SEARCH_CARD" icon={this.genIcon('compass')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="history" label="History" value="QUEST_HISTORY" icon={this.genIcon('hourglass')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="gm" label="GM's Corner" value="GM_CARD" icon={this.genIcon('gm_corner')} />
      </BottomNavigation>
    );
  }
}
