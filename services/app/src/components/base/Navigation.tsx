import BottomNavigation from '@material-ui/core/BottomNavigation';
import BottomNavigationAction from '@material-ui/core/BottomNavigationAction';
import * as React from 'react';
import {CardNameType, CardType, SettingsType} from '../../Types';

export interface StateProps {
  card: CardType;
  settings: SettingsType;
}

export interface DispatchProps {
  toCard: (name: CardNameType, settings: SettingsType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Navigation extends React.Component<Props, {}> {

  private genIcon(name: string): JSX.Element {
    return <img className="inline_icon" src={'images/' + name + '.svg'} />;
  }

  public render() {
    return (
      <BottomNavigation
        id="navfooter"
        showLabels
        value={this.props.card.name || 'MAIN_MENU'}
        onChange={(e: any, name: CardNameType) => this.props.toCard(name, this.props.settings)}
      >
        <BottomNavigationAction classes={{label: 'navlabel'}} id="supply" label="Supply" value="SUPPLY" icon={this.genIcon('supply')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="demand" label="Demand" value="DEMAND" icon={this.genIcon('demand')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="finances" label="Finances" value="FINANCES" icon={this.genIcon('finances')} />
      </BottomNavigation>
    );
  }
}
