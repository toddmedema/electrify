import {Button, Card, CardHeader, IconButton, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import * as React from 'react';

import {SCENARIOS} from 'app/Constants';
import {GameStateType, ScenarioType} from 'app/Types';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onStart: (delta: Partial<GameStateType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface TutorialListItemProps {
  s: ScenarioType;
  onStart: DispatchProps['onStart'];
}

function TutorialListItem(props: TutorialListItemProps): JSX.Element {
  const {s, onStart} = props;
  return (
    <Card className="build-list-item">
      <CardHeader
        action={
          <Button
            size="small"
            variant="contained"
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
      {SCENARIOS.filter((s) => s.tutorialSteps).map((s) => {
        return <TutorialListItem key={s.id} onStart={props.onStart} s={s}/>;
      })}
    </div>
  );
}
