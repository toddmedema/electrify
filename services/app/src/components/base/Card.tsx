import IconButton from '@material-ui/core/IconButton';
import Menu from '@material-ui/core/Menu';
import MenuItem from '@material-ui/core/MenuItem';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import * as React from 'react';
import {connect} from 'react-redux';
import {toCard} from '../../actions/Card';
import {URLS} from '../../Constants';
import {getDevicePlatform, openWindow} from '../../Globals';
import {AppState, CardName, SettingsType, UserState} from '../../reducers/StateTypes';
import {getStore} from '../../Store';

// If onMenuSelect or onReturn is not set, default dispatch behavior is used.
export interface Props extends React.Props<any> {
  header?: JSX.Element;
  icon?: string;
  onReturn?: () => any;
  title?: string | JSX.Element;
  className?: string;
  settings?: SettingsType;
  user?: UserState;
  selectedMenu: CardName|undefined;
}

interface IState {
  anchorEl: HTMLElement|undefined; // undefined instead of null for MaterialUI typing
}

class Card extends React.Component<Props, IState> {
  constructor(props: Props) {
    super(props);
    this.state = {anchorEl: undefined};
  }

  public handleMenuClick(event: React.MouseEvent<HTMLElement>) {
    this.setState({anchorEl: event.currentTarget});
  }

  public handleMenuClose() {
    this.setState({anchorEl: undefined});
  }

  public onMenuSelect(value: string) {
    const dispatch = getStore().dispatch;
    this.handleMenuClose();
    switch (value) {
      case 'ABOUT':
        openWindow(URLS.WEBSITE);
        break;
      case 'HOME':
        return dispatch(toCard({name: 'SPLASH_CARD'}));
      case 'SETTINGS':
        return dispatch(toCard({name: 'SETTINGS'}));
      case 'RATE':
        let err: Error|null = null;
        switch (getDevicePlatform()) {
          case 'android':
            openWindow(URLS.android);
            break;
          case 'ios':
            openWindow(URLS.ios);
            break;
          case 'web':
            err = Error('Cannot rate web app');
            break;
          default:
            err = Error('Uknown platform encountered');
        }
        if (err) {
          throw err;
        }
        break;
      default:
        throw new Error('Unknown menu option ' + value);
    }
  }

  public menuItemDisableProps(value: CardName) {
    const isSelected = this.props.selectedMenu === value;
    return {
      disabled: isSelected,
      selected: isSelected,
    };
  }

  public render() {
    const {anchorEl} = this.state;
    let icon: JSX.Element = <span></span>;
    if (this.props.icon) {
      icon = <img id="bgimg" src={'images/' + this.props.icon + '.svg'}></img>;
    }
    // TODO: Position menu origin at top-right
    // TODO: Style menuStyle={{background: '#f4ebcc'}}
    return (
      <div className="base_card">
        <div className="title_container">
          <span className="menu">
            <IconButton id="menuButton" aria-haspopup="true" onClick={(e) => this.handleMenuClick(e)}>
              <MoreVertIcon/>
            </IconButton>
            <Menu
              open={Boolean(anchorEl)}
              anchorEl={anchorEl}
              classes={{paper: 'menu_popup'}}
              onClose={() => this.handleMenuClose()}>
              <MenuItem id="homeButton" onClick={() => {this.onMenuSelect('HOME'); }}>Home</MenuItem>
              <MenuItem {...this.menuItemDisableProps('SETTINGS')}  onClick={() => {this.onMenuSelect('SETTINGS'); }}>Settings</MenuItem>
              {getDevicePlatform() !== 'web' && <MenuItem onClick={() => {this.onMenuSelect('RATE'); }}>Rate the App</MenuItem>}
              <MenuItem onClick={() => {this.onMenuSelect('ABOUT'); }}>About</MenuItem>
            </Menu>
          </span>
          <div className="title">{this.props.title}</div>
        </div>
    {this.props.header && <div className="header">{this.props.header}</div>}
    <div className="article">
          <div className="scrollbox">
            <div className="child_wrapper">
              {this.props.children}
            </div>
          </div>
          {icon}
        </div>
      </div >
    );
  }
}

const mapStateToProps = (state: AppState, ownProps: Partial<Props>): Props => ({
  settings: state.settings,
  user: state.user,
  selectedMenu: state.card ? state.card.name : undefined,
  ...ownProps,
});

const CardContainer = connect(
  mapStateToProps
)(Card);

export default CardContainer;
