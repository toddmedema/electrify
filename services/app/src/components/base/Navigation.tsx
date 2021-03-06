import {BottomNavigation, BottomNavigationAction} from '@material-ui/core';
import AttachMoneyIcon from '@material-ui/icons/AttachMoney';
import FlashOnIcon from '@material-ui/icons/FlashOn';
import InsertChartIcon from '@material-ui/icons/InsertChart';
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

  // private genIcon(name: string): JSX.Element {
  //   return <img className="inline_icon" src={'images/' + name + '.svg'} />;
  // }

  public render() {
    return (
      <BottomNavigation
        id="navfooter"
        showLabels
        value={this.props.card.name || 'MAIN_MENU'}
        onChange={(e: any, name: CardNameType) => this.props.toCard(name, this.props.settings)}
      >
        <BottomNavigationAction classes={{label: 'navlabel'}} id="faciltiesNav" label="Facilities" value="FACILITIES" icon={<FlashOnIcon />} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="financesNav" label="Finances" value="FINANCES" icon={<AttachMoneyIcon />} />
        <BottomNavigationAction classes={{label: 'navlabel'}} id="forecastsNav" label="Forecasts" value="FORECASTS" icon={<InsertChartIcon />} />
      </BottomNavigation>
    );
  }
}
