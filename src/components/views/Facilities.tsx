import * as React from 'react';
import {Avatar, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, List, ListItem, ListItemAvatar, ListItemSecondaryAction, ListItemText, Toolbar, Typography} from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import {TICK_MINUTES} from '../../Constants';
import {FacilityOperatingType, GameType} from '../../Types';
import {facilityCashBack} from '../../helpers/Financials';
import {formatMoneyConcise, formatWattHours, formatWatts} from '../../helpers/Format';
import ChartSupplyDemand from '../base/ChartSupplyDemand';
import GameCard from '../base/GameCard';

interface FacilityListItemProps {
  facility: FacilityOperatingType;
  spotInList: number;
  listLength: number;
  onSell: DispatchProps['onSell'];
  onReprioritize: DispatchProps['onReprioritize'];
}

const getDraggableStyle = (isDragging: boolean, draggableStyle: any) => ({
  userSelect: 'none',
  border: isDragging ? `1px solid rgba(30, 136, 229, 0.5)` : 'none', // Match buttons
  borderRadius: isDragging ? `4px` : '0',
  ...draggableStyle,
});

function FacilityListItem(props: FacilityListItemProps): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const toggleDialog = () => {
    setOpen(!open);
  };

  const {facility} = props;
  const underConstruction = (facility.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    const percentBuilt = Math.round((facility.yearsToBuild - facility.yearsToBuildLeft) / facility.yearsToBuild * 100);
    secondaryText = `Building: ${percentBuilt}%, ${Math.ceil(props.facility.yearsToBuildLeft * 12)} months left`;
  } else if (facility.peakWh) {
    secondaryText = `${formatWattHours(facility.currentWh).replace(/[^0-9.,]/g, '')}/${formatWattHours(facility.peakWh)}, ${formatWatts(facility.peakW)}`;
  } else {
    secondaryText = `${formatWatts(facility.currentW).replace(/[^0-9.,]/g, '')}/${formatWatts(facility.peakW)}`;
  }

  return (
    <Draggable key={'f' + facility.id} draggableId={'f' + facility.id} index={props.spotInList}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={getDraggableStyle(snapshot.isDragging, provided.draggableProps.style)}
        >
          <ListItem disabled={underConstruction} className="facility">
            <DragIndicatorIcon className="draggable-indicator" color="primary" />
            {facility.currentW > 1000 && <div className="outputProgressBar" style={{width: `${facility.currentW / facility.peakW * 100}%`}}/>}
            <ListItemAvatar>
              <div>
                <Avatar className={(facility.currentWh === 0 ? 'offline' : '')} alt={facility.name} src={`/images/${facility.name.toLowerCase()}.svg`} />
                {facility.peakWh > 0 && !underConstruction && <div className="capacityProgressBar" style={{height: `${facility.currentWh / facility.peakWh * 100}%`}}/>}
              </div>
            </ListItemAvatar>
            <ListItemText
              primary={facility.name}
              secondary={secondaryText}
            />
            <Dialog open={open} onClose={toggleDialog}>
              <DialogTitle>
                {underConstruction ? 'Cancel construction of' : 'Sell'} {facility.peakWh ? formatWattHours(facility.peakWh) : formatWatts(facility.peakW)} {facility.name.toLowerCase()} facility?
              </DialogTitle>
              <DialogContent><DialogContentText>
                You will receive {formatMoneyConcise(facilityCashBack(facility))}
                {facility.loanAmountLeft > 0 ? ` and the rest will go towards paying off the remaining loan balance of ${formatMoneyConcise(facility.loanAmountLeft)}` : ''}.
                {!underConstruction && ` You will be selling your facility to a competitor.`}
              </DialogContentText></DialogContent>
              <DialogActions>
                <Button onClick={toggleDialog} color="primary">
                  Nevermind
                </Button>
                <Button onClick={() => { props.onSell(facility.id); toggleDialog(); }} color="primary" variant="contained" autoFocus>
                  {underConstruction ? 'Cancel construction' : 'Sell'}
                </Button>
              </DialogActions>
            </Dialog>
            <ListItemSecondaryAction>
              {!underConstruction && props.listLength > 1 && <IconButton onClick={toggleDialog} edge="end" color="primary" size="large">
                <DeleteForeverIcon />
              </IconButton>}
              {underConstruction && <IconButton onClick={toggleDialog} edge="end" color="primary" size="large">
                <CancelIcon />
              </IconButton>}
            </ListItemSecondaryAction>
          </ListItem>
        </div>
      )}
    </Draggable>
  );
}

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onGeneratorBuild: () => void;
  onSell: (id: FacilityOperatingType['id']) => void;
  onReprioritize: (spotInList: number, delta: number) => void;
  onStorageBuild: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class Facilities extends React.Component<Props, {}> {
  constructor(props: Props) {
    super(props);
    this.onDragEnd = this.onDragEnd.bind(this);
  }

  public shouldComponentUpdate(nextProps: Props, nextState: any) {
    // In fast modes, skip frames so that CPU can focus on simulation
    switch (nextProps.game.speed) {
      case 'FAST':
        return (nextProps.game.date.minute / TICK_MINUTES % 8 === 0);
      default:
        return true;
    }
  }

  public onDragEnd(result: any) {
    if (!result.destination) { // dropped outside the list
      return;
    }

    this.props.onReprioritize(result.source.index, result.destination.index - result.source.index);
  }

  public render() {
    const {game, onGeneratorBuild, onSell, onReprioritize, onStorageBuild} = this.props;
    const facilitiesCount = game.facilities.length;

    return (
      <GameCard>
        <ChartSupplyDemand
          height={180}
          timeline={game.timeline}
          currentMinute={game.date.minute}
          legend={game.speed === 'PAUSED'}
          startingYear={game.startingYear}
        />
        <List dense className="scrollable">
          <Toolbar style={{paddingBottom: '4px'}}>
            <Typography variant="h6">Facilities</Typography>
            <Button size="small" variant="outlined" color="primary" onClick={onGeneratorBuild} className="button-buildGenerator">+ Generator</Button>
            &nbsp;&nbsp;&nbsp;
            <Button size="small" variant="outlined" color="primary" onClick={onStorageBuild} className="button-buildStorage">+ Storage</Button>
          </Toolbar>
          <DragDropContext onDragEnd={this.onDragEnd}>
            <Droppable droppableId="droppable">
              {(provided, snapshot) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                >
                  {game.facilities.map((g: FacilityOperatingType, i: number) =>
                    <FacilityListItem
                      facility={g}
                      key={g.id}
                      onSell={onSell}
                      onReprioritize={onReprioritize}
                      spotInList={i}
                      listLength={facilitiesCount}
                    />
                  )}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
          {facilitiesCount < 2 && <Typography color="textSecondary" variant="body2" style={{textAlign: 'center', marginTop: '12px'}}>(click "Generator" or "Storage" to build more)</Typography>}
        </List>
      </GameCard>
    );
  }
}
