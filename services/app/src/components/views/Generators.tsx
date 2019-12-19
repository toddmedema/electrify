import Avatar from '@material-ui/core/Avatar';
import Button from '@material-ui/core/Button';
import Card from '@material-ui/core/Card';
import CardContent from '@material-ui/core/CardContent';
import CardHeader from '@material-ui/core/CardHeader';
import Collapse from '@material-ui/core/Collapse';
import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import IconButton from '@material-ui/core/IconButton';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemAvatar from '@material-ui/core/ListItemAvatar';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';
import Slider from '@material-ui/core/Slider';
import Toolbar from '@material-ui/core/Toolbar';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import ArrowDownwardIcon from '@material-ui/icons/ArrowDownward';
import ArrowUpwardIcon from '@material-ui/icons/ArrowUpward';
import CancelIcon from '@material-ui/icons/Cancel';
import CloseIcon from '@material-ui/icons/Close';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';
import InfoIcon from '@material-ui/icons/Info';

import * as React from 'react';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {GENERATORS} from '../../Constants';
import {GameStateType, GeneratorOperatingType, GeneratorShoppingType} from '../../Types';
import BuildCard from '../base/BuildCard';

interface GeneratorListItemProps {
  generator: GeneratorOperatingType;
  spotInList: number;
  listLength: number;
  onSellGenerator: (id: number) => void;
  onReprioritizeGenerator: (spotInList: number, delta: number) => void;
}

function GeneratorListItem(props: GeneratorListItemProps): JSX.Element {
  const underConstruction = (props.generator.yearsToBuildLeft > 0);
  let secondaryText = '';
  if (underConstruction) {
    secondaryText = `Building: ${Math.round((props.generator.yearsToBuild - props.generator.yearsToBuildLeft) / props.generator.yearsToBuild * 100)}%, ${Math.ceil(props.generator.yearsToBuildLeft * 12)} months left`;
  } else {
    secondaryText = `${formatWatts(props.generator.currentW).replace(/\D/g, '')}/${formatWatts(props.generator.peakW)}`;
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
        {!underConstruction && props.spotInList > 0 && <IconButton onClick={() => props.onReprioritizeGenerator(props.spotInList, -1)} color="primary">
          <ArrowUpwardIcon />
        </IconButton>}
        {!underConstruction && props.spotInList < props.listLength - 1 && <IconButton onClick={() => props.onReprioritizeGenerator(props.spotInList, 1)} color="primary">
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

interface GeneratorBuildItemProps {
  cash: number;
  generator: GeneratorShoppingType;
  onBuild: DispatchProps['onBuildGenerator'];
}

function GeneratorBuildItem(props: GeneratorBuildItemProps): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Card>
      <CardHeader
        avatar={<Avatar alt={props.generator.name} src={`/images/${props.generator.name.toLowerCase()}.png`} />}
        action={
          <span>
            <IconButton onClick={handleExpandClick} aria-label="show more">
              <InfoIcon color="primary" />
            </IconButton>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={(e: any) => props.onBuild(props.generator)}
              disabled={props.generator.buildCost > props.cash}
            >
              {formatMoneyConcise(props.generator.buildCost)}
            </Button>
            <Typography variant="body2" color="textSecondary">
              {props.generator.yearsToBuild} years to build
            </Typography>
          </span>
        }
        title={props.generator.name}
        subheader={props.generator.description}
      />
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <CardContent>
          <span>
            Peak output: {formatWatts(props.generator.peakW)}<br/>
            Operating cost: {formatMoneyConcise(props.generator.annualOperatingCost)}/yr
          </span>
        </CardContent>
      </Collapse>
    </Card>
  );
}

// Starting at 1MW, each tick increments the front number - when it overflows, instead add a 0
// (i.e. 1->2MW, 9->10 MW, 10->20MW)
function getW(tick: number) {
  const exponent = Math.floor(tick / 9) + 6;
  const frontNumber = tick % 9 + 1;
  return frontNumber * Math.pow(10, exponent);
}

function valueLabelFormat(x: number) {
  return formatWatts(getW(x));
}

interface ValueLabelProps {
  children: any;
  open: boolean;
  value: number;
}

function ValueLabelComponent(props: ValueLabelProps) {
  return (
    <Tooltip open={props.open} enterTouchDelay={0} placement="top" title={props.value} disableTouchListener={true} arrow={true}>
      {props.children}
    </Tooltip>
  );
}

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBuildGenerator: (generator: GeneratorShoppingType) => void;
  onSellGenerator: (id: number) => void;
  onReprioritizeGenerator: (spotInList: number, delta: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function GeneratorsBuild(props: Props): JSX.Element {
  const {gameState} = props;
  const [open, setOpen] = React.useState(false);
  const [sliderTick, setSliderTick] = React.useState<number>(9);
  const generatorCount = gameState.generators.length;

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleSliderChange = (event: any, newValue: number) => {
    setSliderTick(newValue);
  };

  return (
    <BuildCard className="generators">
      <Toolbar>
        <Typography variant="h6">Generators</Typography>
        <Button size="small" variant="outlined" color="primary" onClick={handleClickOpen}>BUILD</Button>
      </Toolbar>
      <List dense className="scrollable">
        {gameState.generators.map((g: GeneratorOperatingType, i: number) =>
          <GeneratorListItem
            generator={g}
            key={g.id}
            onSellGenerator={(id: number) => props.onSellGenerator(id)}
            onReprioritizeGenerator={props.onReprioritizeGenerator}
            spotInList={i}
            listLength={generatorCount}
          />
        )}
      </List>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
      >
        <Toolbar>
          <Typography variant="h6">Build a Generator ({formatMoneyStable(gameState.cash)})</Typography>
          <IconButton edge="end" color="primary" onClick={handleClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Toolbar>
        <Toolbar>
          <Slider
            value={sliderTick}
            aria-labelledby="peak-output"
            valueLabelDisplay="auto"
            min={0}
            step={1}
            max={36}
            getAriaValueText={valueLabelFormat}
            valueLabelFormat={valueLabelFormat}
            ValueLabelComponent={ValueLabelComponent}
            onChange={handleSliderChange}
          />
        </Toolbar>
        <DialogContent classes={{root: 'generatorBuildList'}}>
          {GENERATORS(gameState, getW(sliderTick)).map((g: GeneratorShoppingType, i: number) =>
            <GeneratorBuildItem
              generator={g}
              key={i}
              cash={gameState.cash}
              onBuild={(generator: GeneratorShoppingType) => { props.onBuildGenerator(generator); handleClose(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </BuildCard>
  );
}
