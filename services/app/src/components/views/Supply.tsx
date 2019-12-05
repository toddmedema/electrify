import Button from '@material-ui/core/Button';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemAvatar from '@material-ui/core/ListItemAvatar';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';
import ListItemText from '@material-ui/core/ListItemText';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import * as React from 'react';
import {formatWatts} from 'shared/helpers/Format';
// import {GENERATORS} from '../../Constants';
import {GameStateType, GeneratorType} from '../../Types';
import BuildCard from '../base/BuildCard';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBuildGenerator: () => void;
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

const SupplyBuild = (props: Props): JSX.Element => {
  return (
    <BuildCard className="generators">
      <Toolbar>
        <Typography variant="h6">Generators</Typography>
        <Button size="small" variant="outlined" color="primary" onClick={props.onBuildGenerator}>BUILD</Button>
      </Toolbar>
      <div id="contents">
        <List dense>
          {props.gameState.generators.map((g: GeneratorType, i: number) => <GeneratorListItem generator={g} key={i} />)}
        </List>
      </div>
    </BuildCard>
  );
};

export default SupplyBuild;
