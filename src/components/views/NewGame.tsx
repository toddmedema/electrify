import * as React from "react";
import {
  Avatar,
  Badge,
  Card,
  CardActionArea,
  CardHeader,
  Chip,
  IconButton,
  List,
  ListSubheader,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { getScenarioLocation } from "../../helpers/Locations";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  SCENARIOS,
  TUTORIALS,
} from "../../data/Scenarios";
import { GameType, ScenarioType } from "../../Types";

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onBack: () => void;
  onCustomGame: () => void;
  onDetails: (delta: Partial<GameType>) => void;
  onManual: () => void;
  onTutorial: (scenarioId: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

interface MissionListItemProps {
  s: ScenarioType;
  completed: boolean;
  // The first mission the player hasn't done yet, called out so the single list has an
  // obvious entry point instead of a dozen equal-looking rows
  next: boolean;
  onSelect: () => void;
}

// One row for everything: tutorial missions, scenarios, and the custom game all share the
// list now - the only differences are the action control and what the subheader shows
function MissionListItem(props: MissionListItemProps): React.JSX.Element {
  const { s, completed, next, onSelect } = props;
  const isTutorial = !!s.tutorialSteps;
  const location = getScenarioLocation(s) || { name: "UNKNOWN" };
  const summary =
    isTutorial || s.id === CUSTOM_SCENARIO_ID ? (
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
      data-testid={`mission-row-${s.id}`}
      className={`build-list-item${next ? " tutorialNext" : ""}`}
    >
      <CardActionArea
        onClick={onSelect}
        autoFocus={next}
        aria-label={
          isTutorial
            ? `${completed ? "Replay" : "Play"} ${s.name}`
            : `View ${s.name} details`
        }
      >
        <CardHeader
          avatar={
            <Badge
              overlap="circular"
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              badgeContent={
                completed ? (
                  <CheckCircleIcon
                    data-testid={`mission-complete-${s.id}`}
                    className="tutorialComplete"
                    color="primary"
                    fontSize="small"
                    titleAccess={`${s.name} completed`}
                  />
                ) : undefined
              }
            >
              <Avatar src={`/images/${s.icon.toLowerCase()}.svg`} />
            </Badge>
          }
          title={<span>{s.name}</span>}
          subheader={<span>{summary}</span>}
          action={
            isTutorial ? (
              <Chip
                label={completed ? "Replay" : "Play"}
                variant={completed ? "outlined" : "filled"}
                color="primary"
              />
            ) : (
              <ArrowRightIcon color="primary" aria-hidden />
            )
          }
        />
      </CardActionArea>
    </Card>
  );
}

export default function NewGame(props: Props): React.JSX.Element {
  const ids = getPlayedScenarioIds();
  const nextTutorial = TUTORIALS.find((s) => ids.indexOf(s.id) === -1);
  const scenarios = SCENARIOS.filter((s) => !s.tutorialSteps);

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
          <Typography component="h1" variant="h6">
            Missions
          </Typography>
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
      <List
        dense
        className="scrollable cardList"
        aria-label="Available missions"
      >
        <ListSubheader
          disableSticky
          sx={{
            bgcolor: "transparent",
            color: "text.primary",
            fontWeight: 700,
          }}
        >
          <Typography
            component="h2"
            variant="subtitle2"
            sx={{ fontWeight: 700 }}
          >
            Training
          </Typography>
          <Typography variant="caption" component="p">
            Six short missions teach the game step by step.
          </Typography>
        </ListSubheader>
        {TUTORIALS.map((s) => (
          <MissionListItem
            key={s.id}
            s={s}
            completed={ids.indexOf(s.id) !== -1}
            next={nextTutorial !== undefined && s.id === nextTutorial.id}
            onSelect={() => props.onTutorial(s.id)}
          />
        ))}
        <ListSubheader
          disableSticky
          sx={{
            bgcolor: "transparent",
            color: "text.primary",
            fontWeight: 700,
          }}
        >
          <Typography
            component="h2"
            variant="subtitle2"
            sx={{ fontWeight: 700 }}
          >
            Scenarios
          </Typography>
        </ListSubheader>
        {scenarios.map((s) => (
          <MissionListItem
            key={s.id}
            s={s}
            completed={ids.indexOf(s.id) !== -1}
            next={false}
            onSelect={() => props.onDetails({ scenarioId: s.id })}
          />
        ))}
        <ListSubheader
          disableSticky
          sx={{
            bgcolor: "transparent",
            color: "text.primary",
            fontWeight: 700,
          }}
        >
          <Typography
            component="h2"
            variant="subtitle2"
            sx={{ fontWeight: 700 }}
          >
            Sandbox
          </Typography>
        </ListSubheader>
        <MissionListItem
          key={CUSTOM_SCENARIO_ID}
          s={DEFAULT_CUSTOM_SCENARIO}
          completed={false}
          next={false}
          onSelect={props.onCustomGame}
        />
      </List>
    </div>
  );
}
