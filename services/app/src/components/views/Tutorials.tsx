import {Button, Card, CardHeader, IconButton, List, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import * as React from 'react';

import {SCENARIOS} from 'app/Scenarios';
import {GameStateType, ScenarioType, ScoresContainerType} from 'app/Types';
import {getStorageJson} from '../../LocalStorage';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onStart: (delta: Partial<GameStateType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface TutorialListItemProps {
  completed: boolean;
  s: ScenarioType;
  onStart: DispatchProps['onStart'];
}

function TutorialListItem(props: TutorialListItemProps): JSX.Element {
  const {s, onStart, completed} = props;
  return (
    <Card className="build-list-item">
      <CardHeader style={{opacity: completed ? 0.8 : 1}}
        action={
          <Button
            size="small"
            variant={completed ? 'outlined' : 'contained'}
            color="primary"
            onClick={(e: any) => onStart({scenarioId: s.id})}
          >
            Play
          </Button>
        }
        title={s.name}
      />
    </Card>
  );
}

export default function Tutorials(props: Props): JSX.Element {
  const scores = (getStorageJson('highscores', {scores: []}) as ScoresContainerType).scores.sort((a, b) => a.score < b.score ? 1 : -1);
  const ids = scores.map((s) => s.scenarioId);

  return (
    <div id="listCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Tutorials</Typography>
        </Toolbar>
      </div>
      <List dense className="scrollable cardList">
        {SCENARIOS.filter((s) => s.tutorialSteps).map((s) => {
          return <TutorialListItem key={s.id} onStart={props.onStart} s={s} completed={ids.indexOf(s.id) !== -1}/>;
        })}
      </List>
    </div>
  );
}
