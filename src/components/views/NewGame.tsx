import * as React from 'react';
import {Avatar, Button, Card, CardHeader, IconButton, List, Toolbar, Typography} from '@mui/material';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import {getStorageJson} from '../../LocalStorage';
import {LOCATIONS} from '../../Constants';
import {SCENARIOS} from '../../Scenarios';
import {GameType, LocalStoragePlayedType, ScenarioType} from '../../Types';

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onBack: () => void;
  onDetails: (delta: Partial<GameType>) => void;
  onTutorial: (delta: Partial<GameType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface TutorialListItemProps {
  completed: boolean;
  s: ScenarioType;
  onTutorial: DispatchProps['onTutorial'];
}

function TutorialListItem(props: TutorialListItemProps): JSX.Element {
  const {s, onTutorial, completed} = props;
  return (
    <Card className="build-list-item">
      <CardHeader style={{opacity: completed ? 0.8 : 1}}
        action={
          <Button
            size="small"
            variant={completed ? 'outlined' : 'contained'}
            color="primary"
            onClick={(e: any) => onTutorial({scenarioId: s.id})}
          >
            {completed ? 'Done' : 'Play'}
          </Button>
        }
        title={s.name}
      />
    </Card>
  );
}

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
  const plays = ((getStorageJson('plays', {plays: []}) as any).plays as LocalStoragePlayedType[]);
  const ids = plays.map((s) => s.scenarioId);

  return (
    <div id="listCard" className="flexContainer">
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
          <Typography variant="h6">Select a Scenario</Typography>
        </Toolbar>
      </div>
      <List dense className="scrollable cardList">
        <Card>
          <CardHeader title='Tutorials' />
        </Card>
        {SCENARIOS.filter((s) => s.tutorialSteps).map((s) => {
          return <TutorialListItem key={s.id} onTutorial={props.onTutorial} s={s} completed={ids.indexOf(s.id) !== -1}/>;
        })}
        <Card>
          <CardHeader title='Scenarios' />
        </Card>
        {SCENARIOS.filter((s) => !s.tutorialSteps).map((s) => {
          return <ScenarioListItem key={s.id} onDetails={props.onDetails} s={s} />;
        })}
      </List>
    </div>
  );
}
