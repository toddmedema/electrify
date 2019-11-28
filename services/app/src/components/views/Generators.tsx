import Button from '@material-ui/core/Button';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemAvatar from '@material-ui/core/ListItemAvatar';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';
import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import {GENERATORS} from '../../Constants';
import {GameStateType, GeneratorType} from '../../Types';
import BuildCard from '../base/BuildCard';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
}

export interface Props extends StateProps, DispatchProps {}

interface GeneratorListItemProps {
  generator: GeneratorType;
}

const GeneratorListItem = (props: GeneratorListItemProps): JSX.Element => {
  const value = 1;
  const labelId = 'Foo';
  return (
    <ListItem key={1} button>
      <ListItemAvatar>
        <span>{props.generator.name}</span>
      </ListItemAvatar>
      <ListItemText
        id={labelId}
        primary={`Line item ${value + 1}`}
        secondary="200MWh"
      />
      <ListItemSecondaryAction>
        <span>HI</span>
      </ListItemSecondaryAction>
    </ListItem>
  );
};

const GeneratorsBuild = (props: Props): JSX.Element => {
  return (
    <BuildCard className="generators">
      <Typography variant="h6">Generators</Typography>
      <Button variant="outlined" color="primary">BUILD</Button>
      <List dense>
        {GENERATORS.map((g: GeneratorType) => <GeneratorListItem generator={g} />)}
      </List>
    </BuildCard>
  );
};

export default GeneratorsBuild;
