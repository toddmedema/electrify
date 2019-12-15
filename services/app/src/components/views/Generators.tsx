import Avatar from '@material-ui/core/Avatar';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import IconButton from '@material-ui/core/IconButton';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemAvatar from '@material-ui/core/ListItemAvatar';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import CloseIcon from '@material-ui/icons/Close';
import DeleteForeverIcon from '@material-ui/icons/DeleteForever';
import * as React from 'react';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {GENERATORS} from '../../Constants';
import {GeneratorOperatingType, GeneratorShoppingType} from '../../Types';
import BuildCard from '../base/BuildCard';

export interface StateProps {
  cash: number;
  generators: GeneratorOperatingType[];
}

export interface DispatchProps {
  onBuildGenerator: (generator: GeneratorShoppingType) => void;
  onSellGenerator: (id: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface GeneratorListItemProps {
  generator: GeneratorOperatingType;
  onSellGenerator: (id: number) => void;
}

function GeneratorListItem(props: GeneratorListItemProps): JSX.Element {
  return (
    <ListItem>
      <ListItemAvatar>
        <Avatar alt={props.generator.name} src={`/images/${props.generator.name.toLowerCase()}.png`} />
      </ListItemAvatar>
      <ListItemText
        primary={props.generator.name}
        secondary={formatWatts(props.generator.peakW)}
      />
      <ListItemSecondaryAction>
        <IconButton onClick={() => props.onSellGenerator(props.generator.id)} edge="end" color="primary">
          <DeleteForeverIcon />
        </IconButton>
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
  return (
    <ListItem alignItems="flex-start">
      <ListItemAvatar>
        <Avatar alt={props.generator.name} src={`/images/${props.generator.name.toLowerCase()}.png`} />
      </ListItemAvatar>
      <ListItemText
        primary={props.generator.name}
        secondary={<span>
          Peak output: {formatWatts(props.generator.peakW)}<br/>
          Operating cost: {formatMoneyConcise(props.generator.annualOperatingCost)}/yr
        </span>}
      />
      <ListItemSecondaryAction>
        <Button
          size="small"
          variant="contained"
          color="primary"
          onClick={(e: any) => props.onBuild(props.generator)}
          disabled={props.generator.buildCost > props.cash}
        >
          {formatMoneyConcise(props.generator.buildCost)}
        </Button>
      </ListItemSecondaryAction>
    </ListItem>
  );
}

export default function GeneratorsBuild(props: Props): JSX.Element {
  const [open, setOpen] = React.useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <BuildCard className="generators">
      <Toolbar>
        <Typography variant="h6">Generators</Typography>
        <Button size="small" variant="outlined" color="primary" onClick={handleClickOpen}>BUILD</Button>
      </Toolbar>
      <List dense className="scrollable">
        {props.generators.map((g: GeneratorOperatingType) =>
          <GeneratorListItem generator={g} key={g.id} onSellGenerator={(id: number) => props.onSellGenerator(id)} />)
        }
      </List>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
      >
        <Toolbar>
          <Typography variant="h6">Build a Generator ({formatMoneyStable(props.cash)})</Typography>
          <IconButton edge="end" color="primary" onClick={handleClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Toolbar>
        <DialogContent>
          <List dense>
            {GENERATORS.map((g: GeneratorShoppingType, i: number) =>
              <GeneratorBuildItem
                generator={g}
                key={i}
                cash={props.cash}
                onBuild={(generator: GeneratorShoppingType) => { props.onBuildGenerator(generator); handleClose(); }}
              />
            )}
          </List>
        </DialogContent>
      </Dialog>
    </BuildCard>
  );
}
