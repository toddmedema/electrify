import {Button, Card, CardHeader, IconButton, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import * as React from 'react';

import {SCENARIOS} from 'app/Scenarios';
import {GameStateType, ScenarioType} from 'app/Types';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onDetails: (delta: Partial<GameStateType>) => void;
  onCustomGame: () => void;
}

export interface Props extends StateProps, DispatchProps {}

interface ScenarioListItemProps {
  s: ScenarioType;
  onDetails: DispatchProps['onDetails'];
}

function ScenarioListItem(props: ScenarioListItemProps): JSX.Element {
  const {s, onDetails} = props;
  return (
    <Card className="build-list-item">
      <CardHeader
        action={
          <Button
            size="small"
            variant="contained"
            color="primary"
            onClick={(e: any) => onDetails({scenarioId: s.id})}
          >
            Details
          </Button>
        }
        title={s.name}
        subheader={s.summary}
      />
    </Card>
  );
}

export default function NewGame(props: Props): JSX.Element {
  return (
    <div id="listCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">New Game</Typography>
        </Toolbar>
      </div>
      {SCENARIOS.filter((s) => !s.tutorialSteps).map((s) => {
        return <ScenarioListItem key={s.id} onDetails={props.onDetails} s={s} />;
      })}
      <ScenarioListItem key={999} onDetails={props.onCustomGame} s={{
        id: 999,
        name: 'Custom Game',
        summary: 'Make your own game',
        startingYear: 2020,
        durationMonths: 20,
        feePerKgCO2e: 0,
      }}/>
    </div>
  );
}
