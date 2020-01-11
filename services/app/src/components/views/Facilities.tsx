import {Avatar, Button, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@material-ui/core';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';

import {TICK_MINUTES} from 'app/Constants';
import {GameStateType, GeneratorOperatingType, StorageOperatingType} from 'app/Types';
import * as React from 'react';
import {formatWattHours, formatWatts} from 'shared/helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';

interface GeneratorListItemProps {
  generator: GeneratorOperatingType;
  spotInList: number;
  listLength: number;
  onSell: DispatchProps['onGeneratorSell'];
  onReprioritize: DispatchProps['onGeneratorReprioritize'];
}

function GeneratorListItem(props: GeneratorListItemProps): JSX.Element {
  const {generator} = props;
  const underConstruction = (generator.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    secondaryText = `Building: ${Math.round((generator.yearsToBuild - generator.yearsToBuildLeft) / generator.yearsToBuild * 100)}%, ${Math.ceil(props.generator.yearsToBuildLeft * 12)} months left`;
  } else {
    secondaryText = `${formatWatts(generator.currentW).replace(/[^0-9.,]/g, '')}/${formatWatts(generator.peakW)}`;
  }
  return (
    <ListItem disabled={underConstruction}>
      <div className="outputProgressBar" style={{width: `${generator.currentW / generator.peakW * 100}%`}}/>
      <ListItemAvatar>
        <Avatar className={(generator.currentW === 0 ? 'offline' : '')} alt={generator.name} src={`/images/${generator.name.toLowerCase()}.svg`} />
      </ListItemAvatar>
      <ListItemText
        primary={generator.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {props.spotInList > 0 && <IconButton onClick={() => props.onReprioritize(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {props.listLength > 1 && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritize(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && props.listLength > 1 && <IconButton onClick={() => props.onSell(generator.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>}
        {underConstruction && <IconButton onClick={() => props.onSell(generator.id)} edge="end" color="primary">
          <CancelIcon />
        </IconButton>}
      </ListItemSecondaryAction>
    </ListItem>
  );
}

interface StorageListItemProps {
  storage: StorageOperatingType;
  spotInList: number;
  listLength: number;
  onSell: DispatchProps['onStorageSell'];
  onReprioritize: DispatchProps['onStorageReprioritize'];
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
      <div className="outputProgressBar" style={{width: `${storage.currentW / storage.peakW * 100}%`}}/>
      <ListItemAvatar>
        <div>
          <Avatar className={(storage.currentWh === 0 ? 'offline' : '')} alt={storage.name} src={`/images/${storage.name.toLowerCase()}.svg`} />
          <div className="capacityProgressBar" style={{height: `${storage.currentWh / storage.peakWh * 100}%`}}/>
        </div>
      </ListItemAvatar>
      <ListItemText
        primary={storage.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {props.spotInList > 0 && <IconButton onClick={() => props.onReprioritize(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {props.listLength > 1 && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritize(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && props.listLength > 1 && <IconButton onClick={() => props.onSell(storage.id)} edge="end" color="primary">
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
  onGeneratorBuild: () => void;
  onGeneratorSell: (id: number) => void;
  onGeneratorReprioritize: (spotInList: number, delta: number) => void;
  onStorageBuild: () => void;
  onStorageSell: (id: number) => void;
  onStorageReprioritize: (spotInList: number, delta: number) => void;
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
    const {gameState, onGeneratorBuild, onGeneratorSell, onGeneratorReprioritize, onStorageBuild, onStorageSell, onStorageReprioritize} = this.props;
    const generatorCount = gameState.generators.length;
    const storageCount = gameState.storage.length;

    return (
      <GameCard>
        <ChartSupplyDemand
          height={180}
          timeline={gameState.timeline}
          currentMinute={gameState.date.minute}
          legend={gameState.speed === 'PAUSED'}
        />
        <Toolbar>
          <Typography variant="h6">Facilities</Typography>
          <Button size="small" variant="outlined" color="primary" onClick={onGeneratorBuild}>+ GEN</Button>
          <Button size="small" variant="outlined" color="primary" onClick={onStorageBuild}>+ STORE</Button>
        </Toolbar>
        <List dense className="scrollable">
          {gameState.generators.map((g: GeneratorOperatingType, i: number) =>
            <GeneratorListItem
              generator={g}
              key={g.id}
              onSell={onGeneratorSell}
              onReprioritize={onGeneratorReprioritize}
              spotInList={i}
              listLength={generatorCount}
            />
          )}
          {gameState.storage.map((g: StorageOperatingType, i: number) =>
            <StorageListItem
              storage={g}
              key={g.id}
              onSell={onStorageSell}
              onReprioritize={onStorageReprioritize}
              spotInList={i}
              listLength={storageCount}
            />
          )}
        </List>
      </GameCard>
    );
  }
}
