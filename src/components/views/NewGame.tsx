import * as React from 'react';
import {Avatar, Card, CardHeader, IconButton, List, Toolbar, Typography} from '@mui/material';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import {LOCATIONS} from '../../Constants';
import {SCENARIOS} from '../../Scenarios';
import {GameStateType, ScenarioType} from '../../Types';

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
  const location = LOCATIONS.find((l) => l.id === s.locationId) || {name: 'UNKNOWN'};
  const summary = s.id === 999 ? s.summary : <span>{s.summary}<br/><i>{location.name} in {s.startingYear}</i></span>;
  return (
    <Card className="build-list-item clickable-card" onClick={(e: any) => onDetails({scenarioId: s.id})}>
      <CardHeader
        avatar={<Avatar src={`/images/${s.icon.toLowerCase()}.svg`} />}
        title={s.name}
        subheader={summary}
        action={
          <IconButton
            color="primary"
            onClick={(e: any) => onDetails({scenarioId: s.id})}
            size="large">
            <ArrowRightIcon/>
          </IconButton>
        }
      />
    </Card>
  );
}

export default function NewGame(props: Props): JSX.Element {
  // TODO BROKEN
  // <ScenarioListItem key={999} onDetails={props.onCustomGame} s={{
  //  id: 999,
    // name: 'Custom Game',
    // icon: 'battery',
    // locationId: 'SF',
    // summary: 'Make your own game',
    // startingYear: 2020,
    // durationMonths: 20,
    // feePerKgCO2e: 0,
    // facilities: [{fuel: 'Natural Gas', peakW: 500000000}],
  // }}/>
  return (
    <div id="listCard">
      <div id="topbar">
        <Toolbar>
          <IconButton
            onClick={props.onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Select scenario</Typography>
        </Toolbar>
      </div>
      <List dense className="scrollable cardList">
        {SCENARIOS.filter((s) => !s.tutorialSteps).map((s) => {
          return <ScenarioListItem key={s.id} onDetails={props.onDetails} s={s} />;
        })}

      </List>
    </div>
  );
}
