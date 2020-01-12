import {Avatar, Button, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@material-ui/core';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';

import {TICK_MINUTES} from 'app/Constants';
import {FacilityOperatingType, GameStateType} from 'app/Types';
import * as React from 'react';
import {formatWattHours, formatWatts} from 'shared/helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';

interface FacilityListItemProps {
  facility: FacilityOperatingType;
  spotInList: number;
  listLength: number;
  onSell: DispatchProps['onSell'];
  onReprioritize: DispatchProps['onReprioritize'];
}

function FacilityListItem(props: FacilityListItemProps): JSX.Element {
  const {facility} = props;
  const underConstruction = (facility.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    secondaryText = `Building: ${Math.round((facility.yearsToBuild - facility.yearsToBuildLeft) / facility.yearsToBuild * 100)}%, ${Math.ceil(props.facility.yearsToBuildLeft * 12)} months left`;
  } else if (facility.peakWh) {
    secondaryText = `${formatWattHours(facility.currentWh).replace(/[^0-9.,]/g, '')}/${formatWattHours(facility.peakWh)}, ${formatWatts(facility.peakW)}`;
  } else {
    secondaryText = `${formatWatts(facility.currentW).replace(/[^0-9.,]/g, '')}/${formatWatts(facility.peakW)}`;
  }
  return (
    <ListItem disabled={underConstruction}>
      {facility.currentW > 0 && <div className="outputProgressBar" style={{width: `${facility.currentW / facility.peakW * 100}%`}}/>}
      <ListItemAvatar>
        <div>
          <Avatar className={(facility.currentWh === 0 ? 'offline' : '')} alt={facility.name} src={`/images/${facility.name.toLowerCase()}.svg`} />
          <div className="capacityProgressBar" style={{height: `${facility.currentWh / facility.peakWh * 100}%`}}/>
        </div>
      </ListItemAvatar>
      <ListItemText
        primary={facility.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {props.spotInList > 0 && <IconButton onClick={() => props.onReprioritize(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {props.listLength > 1 && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritize(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && props.listLength > 1 && <IconButton onClick={() => props.onSell(facility.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>}
        {underConstruction && <IconButton onClick={() => props.onSell(facility.id)} edge="end" color="primary">
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
  onSell: (id: number) => void;
  onReprioritize: (spotInList: number, delta: number) => void;
  onStorageBuild: () => void;
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
    const {gameState, onGeneratorBuild, onSell, onReprioritize, onStorageBuild} = this.props;
    const facilitiesCount = gameState.facilities.length;

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
          <Button size="small" variant="outlined" color="primary" onClick={onGeneratorBuild} className="button-buildGenerator">+ GEN</Button>
          <Button size="small" variant="outlined" color="primary" onClick={onStorageBuild}>+ STORE</Button>
        </Toolbar>
        <List dense className="scrollable">
          {gameState.facilities.map((g: FacilityOperatingType, i: number) =>
            <FacilityListItem
              facility={g}
              key={g.id}
              onSell={onSell}
              onReprioritize={onReprioritize}
              spotInList={i}
              listLength={facilitiesCount}
            />
          )}
        </List>
      </GameCard>
    );
  }
}
