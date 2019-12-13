import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import IconButton from '@material-ui/core/IconButton';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemAvatar from '@material-ui/core/ListItemAvatar';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import CloseIcon from '@material-ui/icons/Close';
import * as React from 'react';
import {formatWatts} from 'shared/helpers/Format';
import {GENERATORS} from '../../Constants';
import {GameStateType, GeneratorType} from '../../Types';
import BuildCard from '../base/BuildCard';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBuildGenerator: (generator: GeneratorType) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface GeneratorListItemProps {
  generator: GeneratorType;
}

const GeneratorListItem = (props: GeneratorListItemProps): JSX.Element => {
  return (
    <ListItem button>
      <ListItemAvatar>
        <span>IMG</span>
      </ListItemAvatar>
      <ListItemText
        primary={props.generator.name}
        secondary={formatWatts(props.generator.peakW)}
      />
      <ListItemSecondaryAction>
        <span>HI</span>
      </ListItemSecondaryAction>
    </ListItem>
  );
};

interface GeneratorBuildItemProps {
  generator: GeneratorType;
  onBuild: DispatchProps['onBuildGenerator'];
}

const GeneratorBuildItem = (props: GeneratorBuildItemProps): JSX.Element => {
  return (
    <ListItem button>
      <ListItemAvatar>
        <span>IMG</span>
      </ListItemAvatar>
      <ListItemText
        primary={props.generator.name}
        secondary={formatWatts(props.generator.peakW)}
      />
      <ListItemSecondaryAction>
        <Button size="small" variant="outlined" color="primary" onClick={(e: any) => props.onBuild(props.generator)}>BUILD</Button>
      </ListItemSecondaryAction>
    </ListItem>
  );
};

export default function SupplyBuild(props: Props) {
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
      <div id="contents">
        <List dense>
          {props.gameState.generators.map((g: GeneratorType, i: number) => <GeneratorListItem generator={g} key={i} />)}
        </List>
      </div>
      <Dialog fullScreen open={open} onClose={handleClose}>
        <Toolbar>
          <Typography variant="h6">Build a Generator</Typography>
          <IconButton edge="end" color="primary" onClick={handleClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Toolbar>
        <List dense>
          {GENERATORS.map((g: GeneratorType, i: number) => <GeneratorBuildItem generator={g} key={i} onBuild={(generator: GeneratorType) => { props.onBuildGenerator(generator); handleClose(); }} />)}
        </List>
      </Dialog>
    </BuildCard>
  );
}
