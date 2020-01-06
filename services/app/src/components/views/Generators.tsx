import {Avatar, Button, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@material-ui/core';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';

import {TICK_MINUTES} from 'app/Constants';
import {GameStateType, GeneratorOperatingType} from 'app/Types';
import * as React from 'react';
import {formatWatts} from 'shared/helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';

interface GeneratorListItemProps {
  generator: GeneratorOperatingType;
  spotInList: number;
  listLength: number;
  onSell: DispatchProps['onSell'];
  onReprioritize: DispatchProps['onReprioritize'];
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
        <Avatar className={(generator.currentW === 0 ? 'offline' : '')} alt={generator.name} src={`/images/${generator.name.toLowerCase()}.png`} />
      </ListItemAvatar>
      <ListItemText
        primary={generator.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {!underConstruction && props.spotInList > 0 && <IconButton onClick={() => props.onReprioritize(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritize(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton onClick={() => props.onSell(generator.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>}
        {underConstruction && <IconButton onClick={() => props.onSell(generator.id)} edge="end" color="primary">
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
    const {gameState, onBuild, onSell, onReprioritize} = this.props;
    const generatorCount = gameState.generators.length;

    return (
      <GameCard className="generators">
        <ChartSupplyDemand
          height={180}
          timeline={gameState.timeline}
          currentMinute={gameState.date.minute}
          legend={gameState.speed === 'PAUSED'}
        />
        <Toolbar>
          <Typography variant="h6">Generators</Typography>
          <Button size="small" variant="outlined" color="primary" onClick={onBuild}>BUILD</Button>
        </Toolbar>
        <List dense className="scrollable">
          {gameState.generators.map((g: GeneratorOperatingType, i: number) =>
            <GeneratorListItem
              generator={g}
              key={g.id}
              onSell={onSell}
              onReprioritize={onReprioritize}
              spotInList={i}
              listLength={generatorCount}
            />
          )}
        </List>
      </GameCard>
    );
  }
}
