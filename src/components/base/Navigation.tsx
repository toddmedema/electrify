import * as React from 'react';
import {BottomNavigation, BottomNavigationAction} from '@mui/material';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import InsertChartIcon from '@mui/icons-material/InsertChart';
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
