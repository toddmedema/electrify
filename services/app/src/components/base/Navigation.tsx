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

  private genIcon(name: string): JSX.Element {
    return <img className="inline_icon" src={'images/' + name + '.svg'} />;
  }

  public render() {
    return (
      <BottomNavigation
        id="navfooter"
        showLabels
        value={this.props.card.name || 'SPLASH_SCREEN'}
        onChange={(e: any, name: CardName) => this.props.toCard(name, this.props.settings)}
      >
        <BottomNavigationAction classes={{label: 'navlabel'}} id="generators" label="Generators" value="GENERATORS" icon={this.genIcon('generators')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="customers" label="Customers" value="CUSTOMERS" icon={this.genIcon('customers')} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="finances" label="Finances" value="FINANCES" icon={this.genIcon('finances')} />
      </BottomNavigation>
    );
  }
}
