import {Avatar, Button, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@material-ui/core';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';

import {TICK_MINUTES} from 'app/Constants';
import {GameStateType, StorageOperatingType, StorageShoppingType} from 'app/Types';
import * as React from 'react';
import {formatWattHours} from 'shared/helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';
import StorageBuildDialog from './StorageBuildDialog';

interface StorageListItemProps {
  storage: StorageOperatingType;
  spotInList: number;
  listLength: number;
  onSellStorage: DispatchProps['onSellStorage'];
  onReprioritizeStorage: DispatchProps['onReprioritizeStorage'];
}

function StorageListItem(props: StorageListItemProps): JSX.Element {
  const underConstruction = (props.storage.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    secondaryText = `Building: ${Math.round((props.storage.yearsToBuild - props.storage.yearsToBuildLeft) / props.storage.yearsToBuild * 100)}%, ${Math.ceil(props.storage.yearsToBuildLeft * 12)} months left`;
  } else {
    secondaryText = `${formatWattHours(props.storage.currentWh).replace(/[^0-9.,]/g, '')}/${formatWattHours(props.storage.peakWh)}`;
  }
  return (
    <ListItem disabled={underConstruction}>
      <ListItemAvatar>
        <Avatar alt={props.storage.name} src={`/images/${props.storage.name.toLowerCase()}.png`} />
      </ListItemAvatar>
      <ListItemText
        primary={props.storage.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {!underConstruction && props.spotInList > 0 && <IconButton onClick={() => props.onReprioritizeStorage(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritizeStorage(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton onClick={() => props.onSellStorage(props.storage.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>}
        {underConstruction && <IconButton onClick={() => props.onSellStorage(props.storage.id)} edge="end" color="primary">
          <CancelIcon />
        </IconButton>}
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export interface StateProps {
  gameState: GameStateType;
  cash: number;
}

export interface DispatchProps {
  onBuildStorage: (storage: StorageShoppingType, financed: boolean) => void;
  onSellStorage: (id: number) => void;
  onReprioritizeStorage: (spotInList: number, delta: number) => void;
}

export interface Props extends StateProps, DispatchProps {}
interface State {
  open: boolean;
}

export default class extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {open: false};
  }

  public shouldComponentUpdate(nextProps: Props, nextState: any) {
    if (nextProps.gameState.speed === 'FAST') {
      return (nextProps.gameState.date.minute / TICK_MINUTES % 2 === 0); // skip rendering alternating frames so that CPU can focus on simulation
    }
    return true;
  }

  public render() {
    const {gameState, cash, onSellStorage, onReprioritizeStorage, onBuildStorage} = this.props;
    const storageCount = gameState.storage.length;

    const toggleOpen = () => {
      this.setState((state: any) => ({open: !state.open }));
    };

    return (
      <GameCard className="storages">
        {this.state.open ? <span/> : <ChartSupplyDemand
          height={180}
          timeline={gameState.timeline}
          currentMinute={gameState.date.minute}
        />}
        <Toolbar>
          <Typography variant="h6">Storage</Typography>
          <Button size="small" variant="outlined" color="primary" onClick={toggleOpen}>BUILD</Button>
        </Toolbar>
        <List dense className="scrollable">
          {gameState.storage.map((g: StorageOperatingType, i: number) =>
            <StorageListItem
              storage={g}
              key={g.id}
              onSellStorage={(id: number) => onSellStorage(id)}
              onReprioritizeStorage={onReprioritizeStorage}
              spotInList={i}
              listLength={storageCount}
            />
          )}
        </List>
        <StorageBuildDialog open={this.state.open} toggleOpen={toggleOpen} gameState={gameState} cash={cash} onBuildStorage={onBuildStorage} />
      </GameCard>
    );
  }
}
