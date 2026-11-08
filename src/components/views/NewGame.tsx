import * as React from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardActionArea,
  CardHeader,
  Chip,
  LinearProgress,
  List,
  ListSubheader,
  Menu,
  MenuItem,
  SvgIcon,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  ChevronDownGlyph,
  ChevronRightGlyph,
  ChevronUpGlyph,
} from "../base/Glyphs";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SortIcon from "@mui/icons-material/Sort";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import NavigableCardRow from "../base/NavigableCardRow";
import ScreenPage from "../base/ScreenPage";
import { getScenarioPlayCounts } from "../../LocalStorage";
import { getScenarioLocation } from "../../helpers/Locations";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
  SCENARIOS,
  TUTORIALS,
} from "../../data/Scenarios";
import {
  CoopSelectionType,
  GameType,
  ScenarioThemeType,
  ScenarioType,
} from "../../Types";
import CoopBrowseBar from "../base/CoopBrowseBar";
import { isLegacyCampaignScenario } from "../../data/LegacyCampaign";

export interface StateProps {
  game: GameType;
  /** Choosing a game with a co-op lobby: no lessons, and guests only follow. */
  coop?: CoopSelectionType;
}

export interface DispatchProps {
  onBack: () => void;
  onCustomGame: () => void;
  onCampaign?: () => void;
  /** Desktop builds with mod support: open the installed community scenarios. */
  onCommunityScenarios?: () => void;
  onDetails: (delta: Partial<GameType>) => void;
  onTutorial: (scenarioId: number) => void;
}

export interface Props extends StateProps, DispatchProps {}

type ChallengeFilterType = "For you" | "All challenges" | ScenarioThemeType;
type ChallengeSortType =
  "RECOMMENDED" | "UNPLAYED" | "NEWEST" | "SHORTEST" | "OLDEST";

const CHALLENGE_THEMES: ScenarioThemeType[] = [
  "Extreme weather",
  "Energy transition",
  "Rapid growth",
];

const CHALLENGE_SORTS: Array<{
  value: ChallengeSortType;
  label: string;
}> = [
  { value: "RECOMMENDED", label: "Recommended" },
  { value: "UNPLAYED", label: "Unplayed first" },
  { value: "NEWEST", label: "Newest first" },
  { value: "SHORTEST", label: "Shortest first" },
  { value: "OLDEST", label: "Oldest first" },
];

function scenarioEndYear(scenario: ScenarioType): number {
  return (
    scenario.startingYear +
    Math.floor(
      ((scenario.startingMonth ?? 1) - 1 + scenario.durationMonths - 1) / 12,
    )
  );
}

interface MissionListItemProps {
  s: ScenarioType;
  completed: boolean;
  onSelect: () => void;
  showThemes?: boolean;
  /** A co-op guest sees the host's list but cannot open a game themselves. */
  readOnly?: boolean;
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
      <Typography component="h2" variant="subtitle2" sx={{ fontWeight: 600 }}>
        {props.children}
      </Typography>
      {props.action}
    </ListSubheader>
  );
}

// MUI's filled CheckCircle cuts its tick out of the disc, so whatever sits behind the badge
// shows through it. A solid white tick reads as "done" on every avatar, in both palettes.
function CompletedCheckIcon(props: React.ComponentProps<typeof SvgIcon>) {
  return (
    <SvgIcon {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z" fill="#fff" />
    </SvgIcon>
  );
}

// One row for everything: tutorial missions, scenarios, and the custom game all share the
// list now - the only differences are the action control and what the subheader shows
function MissionListItem(props: MissionListItemProps): React.JSX.Element {
  const { s, completed, onSelect, showThemes = false, readOnly } = props;
  const isTutorial = !!s.tutorialSteps;
  const name = displayName(s);
  const location = getScenarioLocation(s) || { name: "UNKNOWN" };
  const summary =
    isTutorial || s.id === CUSTOM_SCENARIO_ID ? (
      s.summary
    ) : (
      <>
        <span className="missionCatalogSummary">{s.summary}</span>
        <span className="missionMeta">
          {location.name} · {s.startingYear}–{scenarioEndYear(s)}
        </span>
        {showThemes && s.themes && (
          <span className="missionThemes" aria-label={`${name} themes`}>
            {s.themes.map((theme) => (
              <Chip
                component="span"
                className="missionThemeTag"
                key={theme}
                label={theme}
                size="small"
                variant="outlined"
              />
            ))}
          </span>
        )}
      </>
    );
  return (
    <NavigableCardRow
      testId={`mission-row-${s.id}`}
      className="missionCatalogItem"
      onOpen={readOnly ? undefined : onSelect}
      ariaLabel={
        isTutorial
          ? `${completed ? "Review" : "Start"} ${name}`
          : `View ${name} details`
      }
      showChevron={!isTutorial}
      avatar={
        <Badge
          overlap="circular"
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          badgeContent={
            completed ? (
              <CompletedCheckIcon
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
      description={summary}
    />
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
      <CardActionArea onClick={onSelect} aria-label={`Start ${name}`}>
        <CardHeader
          avatar={
            <Avatar
              src={`/images/${tutorial.icon.toLowerCase()}.svg`}
              alt={`${name} icon`}
            />
          }
          title={<span className="tutorialSpotlightTitle">{name}</span>}
          subheader={tutorial.summary}
          action={
            <span className="tutorialSpotlightAction" aria-hidden>
              Start lesson <ChevronRightGlyph fontSize="small" />
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
  // "For you" ranks by this player's own history, which a co-op lobby doesn't share.
  const [challengeFilter, setChallengeFilter] =
    React.useState<ChallengeFilterType>(
      props.coop ? "All challenges" : "For you",
    );
  const guest = props.coop?.role === "guest";
  const [challengeSort, setChallengeSort] =
    React.useState<ChallengeSortType | null>(null);
  const [challengeSortAnchor, setChallengeSortAnchor] =
    React.useState<HTMLElement | null>(null);
  const playCounts = getScenarioPlayCounts();
  const ids = Object.keys(playCounts).map(Number);
  const completedTutorials = TUTORIALS.filter((s) => ids.includes(s.id)).length;
  const nextTutorial = TUTORIALS.find((s) => ids.indexOf(s.id) === -1);
  const scenarios = SCENARIOS.filter(
    (s) => !s.tutorialSteps && !isLegacyCampaignScenario(s.id),
  ).sort(
    (a, b) =>
      b.startingYear - a.startingYear ||
      scenarioEndYear(b) - scenarioEndYear(a),
  );
  const recommendationRank = (scenario: ScenarioType): number => {
    return scenario.recommendationOrder ?? Number.MAX_SAFE_INTEGER;
  };
  const recommendedScenarios = [...scenarios]
    .sort((a, b) => {
      const aPlays = playCounts[a.id] ?? 0;
      const bPlays = playCounts[b.id] ?? 0;
      return (
        Number(aPlays > 0) - Number(bPlays > 0) ||
        (aPlays > 0 && bPlays > 0 ? bPlays - aPlays : 0) ||
        recommendationRank(a) - recommendationRank(b)
      );
    })
    .slice(0, 3);
  const filteredScenarios =
    challengeFilter === "For you"
      ? recommendedScenarios
      : challengeFilter === "All challenges"
        ? scenarios
        : scenarios.filter((scenario) =>
            scenario.themes?.includes(challengeFilter),
          );
  const effectiveChallengeSort =
    challengeSort ?? (challengeFilter === "For you" ? "RECOMMENDED" : "NEWEST");
  const visibleScenarios = [...filteredScenarios].sort((a, b) => {
    const aPlays = playCounts[a.id] ?? 0;
    const bPlays = playCounts[b.id] ?? 0;
    const recommended =
      Number(aPlays > 0) - Number(bPlays > 0) ||
      (aPlays > 0 && bPlays > 0 ? bPlays - aPlays : 0) ||
      recommendationRank(a) - recommendationRank(b) ||
      a.name.localeCompare(b.name);
    if (effectiveChallengeSort === "RECOMMENDED") {
      return recommended;
    }
    if (effectiveChallengeSort === "UNPLAYED") {
      return (
        Number((playCounts[a.id] ?? 0) > 0) -
          Number((playCounts[b.id] ?? 0) > 0) ||
        b.startingYear - a.startingYear ||
        recommended
      );
    }
    if (effectiveChallengeSort === "SHORTEST") {
      return (
        a.durationMonths - b.durationMonths ||
        b.startingYear - a.startingYear ||
        recommended
      );
    }
    if (effectiveChallengeSort === "OLDEST") {
      return (
        a.startingYear - b.startingYear ||
        scenarioEndYear(a) - scenarioEndYear(b) ||
        recommended
      );
    }
    return (
      b.startingYear - a.startingYear ||
      scenarioEndYear(b) - scenarioEndYear(a) ||
      recommended
    );
  });
  const challengeSortLabel = CHALLENGE_SORTS.find(
    (sort) => sort.value === effectiveChallengeSort,
  )!.label;

  return (
    <ScreenPage
      id="listCard"
      title={props.coop ? "Choose a game together" : "Choose a game"}
      onBack={props.onBack}
    >
      <CoopBrowseBar coop={props.coop} offerSaves />
      <List
        dense
        className="scrollable cardList missionList"
        aria-label="Available games"
      >
        {!props.coop && (
          <>
            <MissionSectionHeader
              action={
                <Button
                  size="small"
                  onClick={() => setShowAllTutorials(!showAllTutorials)}
                  aria-expanded={showAllTutorials}
                  aria-controls="tutorial-catalog"
                  endIcon={
                    showAllTutorials ? <ChevronUpGlyph /> : <ChevronDownGlyph />
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
                <CheckCircleIcon color="action" />
                <span>
                  <strong>Tutorials complete</strong>
                  <Typography
                    component="span"
                    variant="body2"
                    color="textSecondary"
                  >
                    You can repeat any lesson whenever you want.
                  </Typography>
                </span>
              </div>
            )}
            {showAllTutorials && (
              <div
                id="tutorial-catalog"
                className="tutorialCatalog groupedList"
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
          </>
        )}
        {!props.coop && (
          <>
            <MissionSectionHeader>Campaign</MissionSectionHeader>
            <div className="groupedList">
              <NavigableCardRow
                testId="legacy-campaign-entry"
                avatar={<Avatar src="/images/coal.svg" alt="" />}
                title="Legacy campaign"
                description={
                  <span>
                    Build one utility across nine generations.
                    <br />
                    <span className="missionMeta">
                      1882–2061 · 20 years per CEO
                    </span>
                  </span>
                }
                ariaLabel="View legacy campaign"
                onOpen={props.onCampaign}
              />
            </div>
          </>
        )}
        <MissionSectionHeader
          action={
            <Button
              size="small"
              startIcon={<SortIcon />}
              endIcon={<ChevronDownGlyph />}
              onClick={(event) => setChallengeSortAnchor(event.currentTarget)}
              aria-haspopup="menu"
              aria-controls={
                challengeSortAnchor ? "challenge-sort-menu" : undefined
              }
              aria-expanded={!!challengeSortAnchor}
            >
              {challengeSortLabel}
            </Button>
          }
        >
          Challenges
        </MissionSectionHeader>
        <Menu
          id="challenge-sort-menu"
          anchorEl={challengeSortAnchor}
          open={!!challengeSortAnchor}
          onClose={() => setChallengeSortAnchor(null)}
          slotProps={{ list: { "aria-label": "Sort challenges" } }}
        >
          {CHALLENGE_SORTS.map((sort) => (
            <MenuItem
              key={sort.value}
              selected={sort.value === effectiveChallengeSort}
              onClick={() => {
                setChallengeSort(sort.value);
                setChallengeSortAnchor(null);
              }}
            >
              {sort.label}
            </MenuItem>
          ))}
        </Menu>
        <ToggleButtonGroup
          className="challengeFilters"
          value={challengeFilter}
          exclusive
          onChange={(
            _event: React.MouseEvent<HTMLElement>,
            value: ChallengeFilterType | null,
          ) => value && setChallengeFilter(value)}
          aria-label="Browse challenges"
          size="small"
        >
          {(
            [
              ...(props.coop ? [] : ["For you"]),
              ...CHALLENGE_THEMES,
              "All challenges",
            ] as ChallengeFilterType[]
          ).map((filter) => (
            <ToggleButton key={filter} value={filter} aria-label={filter}>
              {filter}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <div
          id="challenge-catalog"
          className="groupedList"
          data-testid="challenge-list"
        >
          {visibleScenarios.map((s) => (
            <MissionListItem
              key={s.id}
              s={s}
              completed={ids.indexOf(s.id) !== -1}
              onSelect={() => props.onDetails({ scenarioId: s.id })}
              showThemes={challengeFilter === "All challenges"}
              readOnly={guest}
            />
          ))}
        </div>
        <MissionSectionHeader>Custom game</MissionSectionHeader>
        <div className="groupedList">
          <MissionListItem
            key={CUSTOM_SCENARIO_ID}
            s={DEFAULT_CUSTOM_SCENARIO}
            completed={false}
            onSelect={props.onCustomGame}
            readOnly={guest}
          />
        </div>
        {props.onCommunityScenarios && !guest && (
          <>
            <MissionSectionHeader>Community scenarios</MissionSectionHeader>
            <div className="groupedList">
              <NavigableCardRow
                testId="community-scenarios"
                onOpen={props.onCommunityScenarios}
                ariaLabel="Open community scenarios"
                avatar={
                  <Avatar aria-hidden>
                    <ExtensionOutlinedIcon />
                  </Avatar>
                }
                title={<span>Mods</span>}
                description={
                  <span>
                    Scenarios from files and Steam Workshop. Unranked.
                  </span>
                }
              />
            </div>
          </>
        )}
      </List>
    </ScreenPage>
  );
}
