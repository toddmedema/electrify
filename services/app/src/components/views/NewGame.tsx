import {Avatar, Card, CardHeader, IconButton, List, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import ArrowRightIcon from '@material-ui/icons/ArrowRight';
import * as React from 'react';

import {SCENARIOS} from 'app/Scenarios';
import {GameStateType, ScenarioType} from 'app/Types';

export interface StateProps {
  gameState: GameStateType;
  user?: any;
  signInWithGoogle?: any;
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
    <Card className="build-list-item clickable-card" onClick={(e: any) => onDetails({scenarioId: s.id})}>
      <CardHeader
        avatar={<Avatar src={`/images/${s.icon.toLowerCase()}.svg`} />}
        title={s.name}
        subheader={s.summary}
        action={
          <IconButton color="primary" onClick={(e: any) => onDetails({scenarioId: s.id})}>
            <ArrowRightIcon/>
          </IconButton>
        }
      />
    </Card>
  );
}

export default function NewGame(props: Props): JSX.Element {
  console.log(props);
  return (
    <div id="listCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Select scenario</Typography>
          <IconButton onClick={props.signInWithGoogle} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
        </Toolbar>
      </div>
      <List dense className="scrollable cardList">
        {SCENARIOS.filter((s) => !s.tutorialSteps).map((s) => {
          return <ScenarioListItem key={s.id} onDetails={props.onDetails} s={s} />;
        })}
        <ScenarioListItem key={999} onDetails={props.onCustomGame} s={{
          id: 999,
          name: 'Custom Game',
          icon: 'battery',
          summary: 'Make your own game',
          startingYear: 2020,
          durationMonths: 20,
          feePerKgCO2e: 0,
          facilities: [{fuel: 'Natural Gas', peakW: 500000000}],
        }}/>
      </List>
    </div>
  );
}
