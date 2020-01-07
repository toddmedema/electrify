import {Avatar, Button, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@material-ui/core';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';

import {TICK_MINUTES} from 'app/Constants';
import {GameStateType, StorageOperatingType} from 'app/Types';
import * as React from 'react';
import {formatWattHours} from 'shared/helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';

interface StorageListItemProps {
  storage: StorageOperatingType;
  spotInList: number;
  listLength: number;
  onSell: DispatchProps['onSell'];
  onReprioritize: DispatchProps['onReprioritize'];
}

function StorageListItem(props: StorageListItemProps): JSX.Element {
  const {storage} = props;
  const underConstruction = (storage.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    secondaryText = `Building: ${Math.round((storage.yearsToBuild - storage.yearsToBuildLeft) / storage.yearsToBuild * 100)}%, ${Math.ceil(props.storage.yearsToBuildLeft * 12)} months left`;
  } else {
    secondaryText = `${formatWattHours(storage.currentWh).replace(/[^0-9.,]/g, '')}/${formatWattHours(storage.peakWh)}`;
  }
  return (
    <ListItem disabled={underConstruction}>
      <div className="outputProgressBar" style={{width: `${storage.currentWh / storage.peakWh * 100}%`}}/>
      <ListItemAvatar>
        <Avatar className={(storage.currentWh === 0 ? 'offline' : '')} alt={storage.name} src={`/images/${storage.name.toLowerCase()}.svg`} />
      </ListItemAvatar>
      <ListItemText
        primary={storage.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {!underConstruction && props.spotInList > 0 && <IconButton onClick={() => props.onReprioritize(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritize(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton onClick={() => props.onSell(storage.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>}
        {underConstruction && <IconButton onClick={() => props.onSell(storage.id)} edge="end" color="primary">
          <CancelIcon />
        </IconButton>}
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBuild: () => void;
  onSell: (id: number) => void;
  onReprioritize: (spotInList: number, delta: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class extends React.Component<Props, {}> {
  public shouldComponentUpdate(nextProps: Props, nextState: any) {
    // In fast modes, skip rendering alternating frames so that CPU can focus on simulation
    switch (nextProps.gameState.speed) {
      case 'FAST':
        return (nextProps.gameState.date.minute / TICK_MINUTES % 2 === 0);
      case 'LIGHTNING':
        return (nextProps.gameState.date.minute / TICK_MINUTES % 4 === 0);
      default:
        return true;
    }
  }

  public render() {
    const {gameState, onSell, onReprioritize, onBuild} = this.props;
    const storageCount = gameState.storage.length;

    return (
      <GameCard className="storages">
        <ChartSupplyDemand
          height={180}
          timeline={gameState.timeline}
          currentMinute={gameState.date.minute}
        />
        <Toolbar>
          <Typography variant="h6">Energy Storage</Typography>
          <Button size="small" variant="outlined" color="primary" onClick={onBuild}>BUILD</Button>
        </Toolbar>
        <List dense className="scrollable">
          {gameState.storage.map((g: StorageOperatingType, i: number) =>
            <StorageListItem
              storage={g}
              key={g.id}
              onSell={(id: number) => onSell(id)}
              onReprioritize={onReprioritize}
              spotInList={i}
              listLength={storageCount}
            />
          )}
        </List>
      </GameCard>
    );
  }
}
