import * as React from "react";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  IconButton,
  LinearProgress,
  List,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { LOCATIONS } from "../../Constants";
import { SCENARIOS, TUTORIALS } from "../../data/Scenarios";
import { GameType, ScenarioType } from "../../Types";

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onBack: () => void;
  onDetails: (delta: Partial<GameType>) => void;
  onManual: () => void;
  onTutorial: (scenarioId: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface TutorialListItemProps {
  completed: boolean;
  // The first tutorial the player hasn't done yet, called out so the sequence has an
  // obvious entry point instead of six equal-looking rows
  next: boolean;
  s: ScenarioType;
  onTutorial: DispatchProps["onTutorial"];
}

function TutorialListItem(props: TutorialListItemProps): JSX.Element {
  const { s, onTutorial, completed, next } = props;
  return (
    <Card className={`build-list-item${next ? " tutorialNext" : ""}`}>
      <CardHeader
        style={{ opacity: completed ? 0.6 : 1 }}
        avatar={
          completed ? (
            <CheckCircleIcon
              className="tutorialComplete"
              color="primary"
              titleAccess={`${s.name} completed`}
            />
          ) : (
            <RadioButtonUncheckedIcon
              className="tutorialIncomplete"
              titleAccess={`${s.name} not yet completed`}
            />
          )
        }
        action={
          <Button
            size="small"
            variant={completed ? "outlined" : "contained"}
            color="primary"
            onClick={(e: any) => onTutorial(s.id)}
            autoFocus={next}
          >
            {completed ? "Replay" : "Play"}
          </Button>
        }
        title={s.name}
        subheader={next ? "Start here" : undefined}
      />
    </Card>
  );
}

interface ScenarioListItemProps {
  s: ScenarioType;
  onDetails: DispatchProps["onDetails"];
}

function ScenarioListItem(props: ScenarioListItemProps): JSX.Element {
  const { s, onDetails } = props;
  const location = LOCATIONS[s.locationId] || {
    name: "UNKNOWN",
  };
  const summary =
    s.id === 999 ? (
      s.summary
    ) : (
      <span>
        {s.summary}
        <br />
        <i>
          {location.name}, {s.startingYear}-
          {s.startingYear + s.durationMonths / 12}
        </i>
      </span>
    );
  return (
    <Card
      className="build-list-item clickable-card"
      onClick={(e: any) => onDetails({ scenarioId: s.id })}
    >
      <CardHeader
        avatar={<Avatar src={`/images/${s.icon.toLowerCase()}.svg`} />}
        title={s.name}
        subheader={summary}
        action={
          <IconButton
            color="primary"
            onClick={(e: any) => onDetails({ scenarioId: s.id })}
            size="large"
          >
            <ArrowRightIcon />
          </IconButton>
        }
      />
    </Card>
  );
}

export default function NewGame(props: Props): JSX.Element {
  const ids = getPlayedScenarioIds();
  const completedTutorials = TUTORIALS.filter(
    (s) => ids.indexOf(s.id) !== -1
  ).length;
  const nextTutorial = TUTORIALS.find((s) => ids.indexOf(s.id) === -1);

  return (
    <div id="listCard" className="flexContainer">
      <div id="topbar">
        <Toolbar>
          <IconButton
            onClick={props.onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large"
          >
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Select a Scenario</Typography>
          {/* Otherwise the Manual is only reachable from the title screen and the in-game
              overflow menu, so players who stop partway through never find out it exists.
              Auto margin rather than absolute positioning, so it can't sit on top of the
              title on narrow screens */}
          <IconButton
            sx={{ marginLeft: "auto" }}
            onClick={props.onManual}
            aria-label="manual"
            color="primary"
            size="large"
          >
            <HelpOutlineIcon />
          </IconButton>
        </Toolbar>
      </div>
      <List dense className="scrollable cardList">
        <Typography variant="h5" sx={{ paddingLeft: 1, paddingTop: 1 }}>
          Tutorials
        </Typography>
        <Typography
          variant="body2"
          color="textSecondary"
          sx={{ paddingLeft: 1, paddingBottom: 1 }}
        >
          {completedTutorials === 0
            ? `New here? These ${TUTORIALS.length} walkthroughs teach the game in order.`
            : `${completedTutorials} of ${TUTORIALS.length} complete`}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={(completedTutorials / TUTORIALS.length) * 100}
          className="tutorialProgressBar"
          aria-label={`Tutorials: ${completedTutorials} of ${TUTORIALS.length} complete`}
        />
        {TUTORIALS.map((s) => {
          return (
            <TutorialListItem
              key={s.id}
              onTutorial={props.onTutorial}
              s={s}
              completed={ids.indexOf(s.id) !== -1}
              next={nextTutorial !== undefined && s.id === nextTutorial.id}
            />
          );
        })}
        <Typography variant="h5" sx={{ paddingLeft: 1, paddingTop: 1 }}>
          Scenarios
        </Typography>
        {SCENARIOS.filter((s: ScenarioType) => !s.tutorialSteps).map((s) => {
          return (
            <ScenarioListItem key={s.id} onDetails={props.onDetails} s={s} />
          );
        })}
      </List>
    </div>
  );
}
