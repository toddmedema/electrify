import {Avatar, Button, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@material-ui/core';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';

import {TICK_MINUTES} from 'app/Constants';
import {GameStateType, GeneratorOperatingType, GeneratorShoppingType} from 'app/Types';
import * as React from 'react';
import {formatWatts} from 'shared/helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';
import GeneratorsBuildDialog from './GeneratorsBuildDialog';

interface GeneratorListItemProps {
  generator: GeneratorOperatingType;
  spotInList: number;
  listLength: number;
  onSellGenerator: DispatchProps['onSellGenerator'];
  onReprioritizeGenerator: DispatchProps['onReprioritizeGenerator'];
}

function GeneratorListItem(props: GeneratorListItemProps): JSX.Element {
  const underConstruction = (props.generator.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    secondaryText = `Building: ${Math.round((props.generator.yearsToBuild - props.generator.yearsToBuildLeft) / props.generator.yearsToBuild * 100)}%, ${Math.ceil(props.generator.yearsToBuildLeft * 12)} months left`;
  } else {
    secondaryText = `${formatWatts(props.generator.currentW).replace(/[^0-9.,]/g, '')}/${formatWatts(props.generator.peakW)}`;
  }
  return (
    <ListItem disabled={underConstruction}>
      <ListItemAvatar>
        <Avatar alt={props.generator.name} src={`/images/${props.generator.name.toLowerCase()}.png`} />
      </ListItemAvatar>
      <ListItemText
        primary={props.generator.name}
        secondary={secondaryText}
      />
      <ListItemSecondaryAction>
        {!underConstruction && props.spotInList > 0 && <IconButton onClick={() => props.onReprioritizeGenerator(props.spotInList, -1)} edge="end" color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton disabled={props.spotInList === props.listLength - 1} onClick={() => props.onReprioritizeGenerator(props.spotInList, 1)} edge="end" color="primary">
          <ArrowDownwardIcon />
        </IconButton>}
        {!underConstruction && <IconButton onClick={() => props.onSellGenerator(props.generator.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>}
        {underConstruction && <IconButton onClick={() => props.onSellGenerator(props.generator.id)} edge="end" color="primary">
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
  onBuildGenerator: (generator: GeneratorShoppingType, financed: boolean) => void;
  onSellGenerator: (id: number) => void;
  onReprioritizeGenerator: (spotInList: number, delta: number) => void;
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
    const {gameState, cash, onSellGenerator, onReprioritizeGenerator, onBuildGenerator} = this.props;
    const generatorCount = gameState.generators.length;

    const toggleOpen = () => {
      this.setState((state: any) => ({open: !state.open }));
    };

    return (
      <GameCard className="generators">
        {this.state.open ? <span/> : <ChartSupplyDemand
          height={180}
          timeline={gameState.timeline}
          currentMinute={gameState.date.minute}
        />}
        <Toolbar>
          <Typography variant="h6">Generators</Typography>
          <Button size="small" variant="outlined" color="primary" onClick={toggleOpen}>BUILD</Button>
        </Toolbar>
        <List dense className="scrollable">
          {gameState.generators.map((g: GeneratorOperatingType, i: number) =>
            <GeneratorListItem
              generator={g}
              key={g.id}
              onSellGenerator={(id: number) => onSellGenerator(id)}
              onReprioritizeGenerator={onReprioritizeGenerator}
              spotInList={i}
              listLength={generatorCount}
            />
          )}
        </List>
        <GeneratorsBuildDialog open={this.state.open} toggleOpen={toggleOpen} gameState={gameState} cash={cash} onBuildGenerator={onBuildGenerator} />
      </GameCard>
    );
  }
}
