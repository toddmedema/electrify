import * as React from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardActionArea,
  CardHeader,
  IconButton,
  LinearProgress,
  List,
  ListSubheader,
  Toolbar,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { getScenarioLocation } from "../../helpers/Locations";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  SCENARIOS,
  TUTORIALS,
} from "../../data/Scenarios";
import { GameType, ScenarioThemeType, ScenarioType } from "../../Types";

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

type ChallengeFilterType = "All" | ScenarioThemeType;

const CHALLENGE_THEMES: ScenarioThemeType[] = [
  "Extreme weather",
  "Energy transition",
  "Rapid growth",
  "Island grids",
  "Sudden disruption",
];

function scenarioEndYear(scenario: ScenarioType): number {
  return scenario.startingYear + Math.ceil(scenario.durationMonths / 12) - 1;
}

interface MissionListItemProps {
  s: ScenarioType;
  completed: boolean;
  onSelect: () => void;
}

function displayName(s: ScenarioType): string {
  return s.name.replace(/^Mission \d+:\s*/, "");
}

interface MissionSectionHeaderProps {
  children: React.ReactNode;
  action?: React.ReactNode;
}

function MissionSectionHeader(
  props: MissionSectionHeaderProps,
): React.JSX.Element {
  return (
    <ListSubheader disableSticky className="missionSectionHeader">
      <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 700 }}>
        {props.children}
      </Typography>
      {props.action}
    </ListSubheader>
  );
}

// One row for everything: tutorial missions, scenarios, and the custom game all share the
// list now - the only differences are the action control and what the subheader shows
function MissionListItem(props: MissionListItemProps): React.JSX.Element {
  const { s, completed, onSelect } = props;
  const isTutorial = !!s.tutorialSteps;
  const name = displayName(s);
  const location = getScenarioLocation(s) || { name: "UNKNOWN" };
  const summary =
    isTutorial || s.id === CUSTOM_SCENARIO_ID ? (
      s.summary
    ) : (
      <span>
        {s.summary}
        <br />
        <span className="missionMeta">
          {location.name} · {s.startingYear}–{scenarioEndYear(s)}
        </span>
      </span>
    );
  return (
    <Card
      data-testid={`mission-row-${s.id}`}
      className="build-list-item missionItem"
    >
      <CardActionArea
        onClick={onSelect}
        aria-label={
          isTutorial
            ? `${completed ? "Review" : "Start"} ${name}`
            : `View ${name} details`
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
              <Avatar
                src={`/images/${s.icon.toLowerCase()}.svg`}
                alt={`${name} icon`}
              />
            </Badge>
          }
          title={<span>{name}</span>}
          subheader={<span>{summary}</span>}
          action={!isTutorial && <ArrowRightIcon color="primary" aria-hidden />}
        />
      </CardActionArea>
    </Card>
  );
}

interface TutorialSpotlightProps {
  completedTutorials: number;
  onSelect: () => void;
  tutorial: ScenarioType;
}

function TutorialSpotlight(props: TutorialSpotlightProps): React.JSX.Element {
  const { completedTutorials, onSelect, tutorial } = props;
  const name = displayName(tutorial);
  return (
    <Card
      data-testid={`tutorial-spotlight-${tutorial.id}`}
      className="tutorialSpotlight"
    >
      <CardActionArea onClick={onSelect} autoFocus aria-label={`Start ${name}`}>
        <CardHeader
          avatar={
            <Avatar
              src={`/images/${tutorial.icon.toLowerCase()}.svg`}
              alt={`${name} icon`}
            />
          }
          title={
            <span>
              <span className="tutorialSpotlightEyebrow">
                Continue learning · {completedTutorials} of {TUTORIALS.length}{" "}
                complete
              </span>
              <span className="tutorialSpotlightTitle">{name}</span>
            </span>
          }
          subheader={tutorial.summary}
          action={
            <span className="tutorialSpotlightAction" aria-hidden>
              Start lesson <ArrowRightIcon fontSize="small" />
            </span>
          }
        />
        <LinearProgress
          variant="determinate"
          value={(completedTutorials / TUTORIALS.length) * 100}
          className="tutorialSpotlightProgress"
          aria-label={`Tutorials: ${completedTutorials} of ${TUTORIALS.length} complete`}
        />
      </CardActionArea>
    </Card>
  );
}

export default function NewGame(props: Props): React.JSX.Element {
  const [showAllTutorials, setShowAllTutorials] = React.useState(false);
  const [showAllChallenges, setShowAllChallenges] = React.useState(false);
  const [challengeFilter, setChallengeFilter] =
    React.useState<ChallengeFilterType>("All");
  const ids = getPlayedScenarioIds();
  const completedTutorials = TUTORIALS.filter((s) => ids.includes(s.id)).length;
  const nextTutorial = TUTORIALS.find((s) => ids.indexOf(s.id) === -1);
  const scenarios = SCENARIOS.filter((s) => !s.tutorialSteps).sort(
    (a, b) =>
      b.startingYear - a.startingYear ||
      scenarioEndYear(b) - scenarioEndYear(a),
  );
  const recommendationRank = (scenario: ScenarioType): number => {
    return scenario.recommendationOrder ?? Number.MAX_SAFE_INTEGER;
  };
  const recommendedScenarios = [...scenarios]
    .sort(
      (a, b) =>
        Number(ids.includes(a.id)) - Number(ids.includes(b.id)) ||
        recommendationRank(a) - recommendationRank(b),
    )
    .slice(0, 3);
  const visibleScenarios = showAllChallenges
    ? scenarios.filter(
        (scenario) =>
          challengeFilter === "All" ||
          scenario.themes?.includes(challengeFilter),
      )
    : recommendedScenarios;

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
            Choose a game
          </Typography>
          {/* Otherwise the Manual is only reachable from the title screen and the in-game
              overflow menu, so players who stop partway through never find out it exists.
              Auto margin rather than absolute positioning, so it can't sit on top of the
              title on narrow screens */}
          <IconButton
            sx={{ marginLeft: "auto" }}
            onClick={props.onManual}
            aria-label="How to play"
            color="primary"
            size="large"
          >
            <HelpOutlineIcon />
          </IconButton>
        </Toolbar>
      </div>
      <List
        dense
        className="scrollable cardList missionList"
        aria-label="Available games"
      >
        <MissionSectionHeader
          action={
            <Button
              size="small"
              onClick={() => setShowAllTutorials(!showAllTutorials)}
              aria-expanded={showAllTutorials}
              aria-controls="tutorial-catalog"
              endIcon={
                showAllTutorials ? <ExpandLessIcon /> : <ExpandMoreIcon />
              }
            >
              {showAllTutorials
                ? "Hide lessons"
                : `View all ${TUTORIALS.length}`}
            </Button>
          }
        >
          Learn the basics
        </MissionSectionHeader>
        {nextTutorial ? (
          <TutorialSpotlight
            tutorial={nextTutorial}
            completedTutorials={completedTutorials}
            onSelect={() => props.onTutorial(nextTutorial.id)}
          />
        ) : (
          <div className="tutorialCompleteSummary">
            <CheckCircleIcon color="primary" />
            <span>
              <strong>Tutorials complete</strong>
              <Typography
                component="span"
                variant="body2"
                color="textSecondary"
              >
                You can replay any lesson whenever you want.
              </Typography>
            </span>
          </div>
        )}
        {showAllTutorials && (
          <div
            id="tutorial-catalog"
            className="tutorialCatalog"
            role="group"
            aria-label="All tutorials"
          >
            {TUTORIALS.map((s) => (
              <MissionListItem
                key={s.id}
                s={s}
                completed={ids.indexOf(s.id) !== -1}
                onSelect={() => props.onTutorial(s.id)}
              />
            ))}
          </div>
        )}
        <MissionSectionHeader
          action={
            <Button
              size="small"
              onClick={() => {
                setShowAllChallenges(!showAllChallenges);
                setChallengeFilter("All");
              }}
              aria-expanded={showAllChallenges}
              aria-controls="challenge-catalog"
              endIcon={
                showAllChallenges ? <ExpandLessIcon /> : <ExpandMoreIcon />
              }
            >
              {showAllChallenges
                ? "Show recommendations"
                : `View all ${scenarios.length}`}
            </Button>
          }
        >
          Challenges
        </MissionSectionHeader>
        {showAllChallenges ? (
          <ToggleButtonGroup
            className="challengeFilters"
            value={challengeFilter}
            exclusive
            onChange={(
              _event: React.MouseEvent<HTMLElement>,
              value: ChallengeFilterType | null,
            ) => value && setChallengeFilter(value)}
            aria-label="Filter challenges by theme"
            size="small"
          >
            {(["All", ...CHALLENGE_THEMES] as ChallengeFilterType[]).map(
              (theme) => (
                <ToggleButton key={theme} value={theme} aria-label={theme}>
                  {theme}
                </ToggleButton>
              ),
            )}
          </ToggleButtonGroup>
        ) : (
          <Typography className="challengeBrowseCaption" variant="body2">
            Recommended for you
          </Typography>
        )}
        <div id="challenge-catalog" data-testid="challenge-list">
          {visibleScenarios.map((s) => (
            <MissionListItem
              key={s.id}
              s={s}
              completed={ids.indexOf(s.id) !== -1}
              onSelect={() => props.onDetails({ scenarioId: s.id })}
            />
          ))}
        </div>
        <MissionSectionHeader>Custom game</MissionSectionHeader>
        <MissionListItem
          key={CUSTOM_SCENARIO_ID}
          s={DEFAULT_CUSTOM_SCENARIO}
          completed={false}
          onSelect={props.onCustomGame}
        />
      </List>
    </div>
  );
}
