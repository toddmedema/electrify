import { activeScenario } from "../../helpers/GameSelectors";
import * as React from "react";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import {
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import ScreenPage from "../base/ScreenPage";
import InfoIcon from "@mui/icons-material/Info";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import VictoryConditionsDialog from "../base/VictoryConditionsDialog";
import ConceptIcon, { ConceptNameType } from "../base/ConceptIcon";
import { DIFFICULTY_LABELS, difficultyLabel } from "../../Constants";
import DifficultyPicker from "../base/DifficultyPicker";
import { getDb } from "../../Globals";
import SignInButtons from "../base/SignInButtons";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import CoopBrowseBar, { CoopStartButton } from "../base/CoopBrowseBar";
import {
  ChallengeInvitation,
  CoopSelectionType,
  GameType,
  LocationType,
  ScenarioType,
  ScoreType,
} from "../../Types";

import { formatScore } from "../../helpers/Format";
import { isDesktopApp } from "../../Desktop";
import { SCORE_VERSION } from "../../helpers/Scoring";

export interface StateProps {
  challenge?: ChallengeInvitation;
  onContinue?: () => void;
  game: GameType;
  uid?: string;
  /** Choosing with a co-op lobby: the host starts for everyone; guests mark Ready. */
  coop?: CoopSelectionType;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameType>) => void;
  onStart: (scenarioId: number) => void;
}

interface State {
  scores?: ScoreType[];
  allScores?: ScoreType[];
  myTopScore?: ScoreType;
  // Tells "nobody has played this yet" apart from "the board couldn't be read"
  boardFailed?: boolean;
  allScoresFailed?: boolean;
  scenario: ScenarioType | null;
  location: LocationType | null;
  victoryDialogOpen?: boolean;
  leaderboardExpanded?: boolean;
  leaderboardMinHeight?: number;
  steamScope?: "global" | "friends";
}

export interface Props extends StateProps, DispatchProps {}

function BriefingFact(props: {
  concept: ConceptNameType;
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="scenarioBriefingFact">
      <ConceptIcon concept={props.concept} fontSize="small" />
      <div>
        <Typography variant="overline" component="div">
          {props.label}
        </Typography>
        <Typography variant="body2">{props.children}</Typography>
      </div>
      {props.action}
    </div>
  );
}

export default class NewGameDetails extends React.Component<Props, State> {
  private boardRequestId = 0;
  private myBestRequestId = 0;
  private allScoresRequestId = 0;
  private leaderboardRef = React.createRef<HTMLDivElement>();

  constructor(props: Props) {
    super(props);
    const scenario = activeScenario(props.game) || null;
    this.state = {
      scenario,
      location: getScenarioLocation(scenario) || null,
    };
  }

  /**
   * The board itself, which is public -- anyone can read it, logged in or not. Seeing named
   * strangers above you is the reason to sign up, so hiding it behind a login inverted the very
   * incentive it exists to create.
   */
  private async loadBoard() {
    if (this.props.challenge) return;
    const scenario = this.state.scenario;
    if (!scenario) {
      return;
    }
    const requestId = ++this.boardRequestId;
    const difficulty = this.props.game.difficulty;
    // Keep the compact board's space while another difficulty loads or has fewer scores.
    // Collapsing it briefly clamps the scroller and moves the difficulty buttons above it.
    const leaderboardMinHeight = this.state.leaderboardExpanded
      ? this.state.leaderboardMinHeight
      : Math.max(
          this.state.leaderboardMinHeight || 0,
          this.leaderboardRef.current?.getBoundingClientRect().height || 0,
        );
    this.setState({
      scores: undefined,
      boardFailed: false,
      leaderboardMinHeight,
    });
    try {
      if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
        const { desktopScores } = await import("../../DesktopScores");
        const scores = await desktopScores(
          scenario.id,
          difficulty,
          this.state.steamScope || "global",
        );
        if (requestId === this.boardRequestId) this.setState({ scores });
        return;
      }
      const querySnapshot = await getDocs(
        query(
          collection(getDb(), "scores"),
          where("scoreVersion", "==", SCORE_VERSION),
          where("outcome", "==", "completed"),
          where("scenarioId", "==", scenario.id),
          where("difficulty", "==", difficulty),
          orderBy("score", "desc"),
          limit(50),
        ),
      );
      if (requestId !== this.boardRequestId) {
        return;
      }
      // Set in one go rather than once per document: fifty setStates to draw one table meant
      // laying out a table that grew by a row each time
      this.setState({
        scores: querySnapshot.docs.map((doc) => doc.data() as ScoreType),
      });
    } catch (err) {
      console.warn("Couldn't load the high scores: ", err);
      if (requestId === this.boardRequestId) {
        this.setState({ scores: [], boardFailed: true });
      }
    }
  }

  /** Loads the scenario-wide board only when the player asks to compare every difficulty. */
  private async loadAllScores() {
    const scenario = this.state.scenario;
    if (!scenario) {
      return;
    }
    const requestId = ++this.allScoresRequestId;
    this.setState({ allScores: undefined, allScoresFailed: false });
    try {
      if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
        const { desktopScores } = await import("../../DesktopScores");
        const allScores = await desktopScores(
          scenario.id,
          undefined,
          this.state.steamScope || "global",
        );
        if (requestId === this.allScoresRequestId) this.setState({ allScores });
        return;
      }
      const querySnapshot = await getDocs(
        query(
          collection(getDb(), "scores"),
          where("scoreVersion", "==", SCORE_VERSION),
          where("outcome", "==", "completed"),
          where("scenarioId", "==", scenario.id),
          orderBy("score", "desc"),
          limit(50),
        ),
      );
      if (requestId !== this.allScoresRequestId) return;
      this.setState({
        allScores: querySnapshot.docs.map((doc) => doc.data() as ScoreType),
      });
    } catch (err) {
      console.warn("Couldn't load all high scores: ", err);
      if (requestId === this.allScoresRequestId)
        this.setState({ allScores: [], allScoresFailed: true });
    }
  }

  private toggleLeaderboard() {
    const leaderboardExpanded = !this.state.leaderboardExpanded;
    this.setState({ leaderboardExpanded });
    if (
      leaderboardExpanded &&
      (!this.state.allScores || this.state.allScoresFailed)
    ) {
      void this.loadAllScores();
    }
  }

  /** The player's own best, which is the one row worth showing above the rest. */
  private async loadMyBest(uid: string) {
    const scenario = this.state.scenario;
    if (!scenario) {
      return;
    }
    const requestId = ++this.myBestRequestId;
    const difficulty = this.props.game.difficulty;
    this.setState({ myTopScore: undefined });
    try {
      if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
        const { desktopScores } = await import("../../DesktopScores");
        const scores = await desktopScores(scenario.id, difficulty, "player");
        if (requestId === this.myBestRequestId)
          this.setState({ myTopScore: scores[0] });
        return;
      }
      const querySnapshot = await getDocs(
        query(
          collection(getDb(), "scores"),
          where("scoreVersion", "==", SCORE_VERSION),
          where("outcome", "==", "completed"),
          where("scenarioId", "==", scenario.id),
          where("difficulty", "==", difficulty),
          where("uid", "==", uid),
          orderBy("score", "desc"),
          limit(1),
        ),
      );
      if (requestId === this.myBestRequestId) {
        this.setState({
          myTopScore: querySnapshot.docs[0]?.data() as ScoreType | undefined,
        });
      }
    } catch (err) {
      console.warn("Couldn't load your best score: ", err);
    }
  }

  public componentDidMount() {
    if (this.state.location) {
      void prefetchScenarioData(this.state.location);
    }
    // Unconditional: the board is public, so it no longer waits on a login that may never come.
    // It used to be kicked off from shouldComponentUpdate, which is a purity hook and not a place
    // to start network requests from
    this.loadBoard();
    if (this.props.uid) {
      this.loadMyBest(this.props.uid);
    }
  }

  public componentWillUnmount() {
    ++this.boardRequestId;
    ++this.myBestRequestId;
    ++this.allScoresRequestId;
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.game.scenarioId !== prevProps.game.scenarioId) {
      const scenario =
        getScenario(
          this.props.game.scenarioId,
          this.props.game.customScenario,
        ) || null;
      this.setState(
        {
          scenario,
          location: getScenarioLocation(scenario) || null,
          leaderboardMinHeight: undefined,
        },
        () => this.loadBoard(),
      );
      return;
    }
    if (this.props.game.difficulty !== prevProps.game.difficulty) {
      this.loadBoard();
      if (this.props.uid) {
        this.loadMyBest(this.props.uid);
      }
      return;
    }
    // Logging in from the button below the board is what makes "your best" answerable
    if (this.props.uid && this.props.uid !== prevProps.uid) {
      this.loadMyBest(this.props.uid);
    } else if (!this.props.uid && prevProps.uid) {
      ++this.myBestRequestId;
      this.setState({ myTopScore: undefined });
    }
  }

  public render() {
    const { onBack, onDelta, onStart, game, uid, challenge, onContinue, coop } =
      this.props;
    const {
      scenario,
      scores,
      myTopScore,
      location,
      victoryDialogOpen,
      boardFailed,
      allScores,
      allScoresFailed,
      leaderboardExpanded,
      leaderboardMinHeight,
    } = this.state;

    const toggleVictoryDialog = (e: React.SyntheticEvent) => {
      this.setState({ victoryDialogOpen: !victoryDialogOpen });
      e.stopPropagation();
    };

    if (!scenario || !location) {
      return (
        <ScreenPage title="Unknown scenario or location" onBack={onBack} />
      );
    }

    const briefing = scenario.briefing || {
      fantasy: scenario.summary || scenario.name,
      objective: "Keep the lights on and finish the term.",
      threat: "Blackouts and insolvency can end the run early.",
    };
    const endYear =
      scenario.startingYear + Math.ceil(scenario.durationMonths / 12) - 1;
    const visibleScores = leaderboardExpanded ? allScores : scores?.slice(0, 3);
    // Steam boards use the signed-in Steam account.
    const desktopApp =
      process.env.REACT_APP_DESKTOP === "true" && isDesktopApp();
    const scoreColumnCount = leaderboardExpanded ? 4 : 3;
    const visibleBoardFailed = leaderboardExpanded
      ? allScoresFailed
      : boardFailed;

    return (
      <ScreenPage
        id="listCard"
        title={challenge ? "Friend challenge" : "Game details"}
        titleComponent="div"
        onBack={onBack}
      >
        <CoopBrowseBar coop={coop} />
        <div className="scrollable">
          <section className="scenarioDossier" aria-labelledby="scenario-title">
            <img
              className="scenarioDossierIcon"
              src={`/images/${scenario.icon.toLowerCase()}.svg`}
              alt={`${scenario.name} icon`}
            />
            <div className="scenarioDossierCopy">
              <Typography
                id="scenario-title"
                variant="h6"
                component="h1"
                sx={{ fontWeight: 600, lineHeight: 1.2 }}
              >
                {scenario.name}
              </Typography>
              <Typography variant="overline" component="div">
                {location.name} · {scenario.startingYear}–{endYear}
              </Typography>
              <Typography variant="body1" color="textSecondary">
                {briefing.fantasy}
              </Typography>
              <div className="scenarioBriefingFacts">
                <BriefingFact
                  concept="goal"
                  label="Your goal"
                  action={
                    <IconButton
                      onClick={toggleVictoryDialog}
                      aria-label="Victory Conditions"
                      color="primary"
                      size="small"
                    >
                      <InfoIcon />
                    </IconButton>
                  }
                >
                  {briefing.objective}
                </BriefingFact>
                <BriefingFact concept="danger" label="Watch out">
                  {briefing.threat}
                </BriefingFact>
              </div>
              <div className="scenarioStartControls">
                {challenge ? (
                  <div className="difficultyPicker">
                    <Typography variant="body1">
                      <strong>
                        Friend’s score: {formatScore(challenge.target)}
                      </strong>
                    </Typography>
                    <Typography variant="body2">
                      {DIFFICULTY_LABELS[game.difficulty]}
                    </Typography>
                  </div>
                ) : (
                  <div className="difficultyPicker">
                    <DifficultyPicker
                      variant="toggle"
                      showDescription
                      value={game.difficulty}
                      onChange={(difficulty) => onDelta({ difficulty })}
                      readOnly={coop?.role === "guest"}
                    />
                  </div>
                )}
                {coop ? (
                  <CoopStartButton
                    className="scenarioStartButton"
                    coop={coop}
                    onStart={() => onStart(scenario.id)}
                  />
                ) : (
                  <Button
                    className="scenarioStartButton"
                    size="large"
                    variant="contained"
                    color="primary"
                    onClick={() => onStart(scenario.id)}
                    startIcon={<PlayCircleIcon />}
                  >
                    {challenge ? "Start challenge" : "Start game"}
                  </Button>
                )}
              </div>
              {onContinue && !coop && (
                <Button onClick={onContinue}>Continue saved game</Button>
              )}
            </div>
          </section>

          <VictoryConditionsDialog
            open={victoryDialogOpen || false}
            onClose={() => this.setState({ victoryDialogOpen: false })}
            title="Victory Conditions"
            scenario={scenario}
            difficulty={game.difficulty}
          />

          {!challenge && !coop && (
            <div
              className="leaderboard"
              role="region"
              aria-labelledby="leaderboard-title"
              ref={this.leaderboardRef}
              style={{
                minHeight: leaderboardExpanded
                  ? undefined
                  : leaderboardMinHeight,
              }}
            >
              {desktopApp && (
                <ToggleButtonGroup
                  exclusive
                  value={this.state.steamScope || "global"}
                  aria-label="Steam leaderboard"
                  size="small"
                  sx={{ m: 1.5 }}
                  onChange={(
                    _event,
                    steamScope: "global" | "friends" | null,
                  ) => {
                    if (!steamScope) return;
                    this.setState({ steamScope, allScores: undefined }, () => {
                      void this.loadBoard();
                      if (this.state.leaderboardExpanded)
                        void this.loadAllScores();
                    });
                  }}
                >
                  <ToggleButton value="global">Global</ToggleButton>
                  <ToggleButton value="friends">Friends</ToggleButton>
                </ToggleButtonGroup>
              )}
              <Table id="HighScores">
                <TableHead>
                  <TableRow>
                    <TableCell colSpan={scoreColumnCount}>
                      <Typography id="leaderboard-title" variant="h6">
                        {leaderboardExpanded
                          ? "Leaderboard — All levels"
                          : `Leaderboard — ${DIFFICULTY_LABELS[game.difficulty]}`}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="rank">#</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Score</TableCell>
                    {leaderboardExpanded && <TableCell>Level</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {myTopScore && (
                    <TableRow
                      sx={{ fontWeight: 600, bgcolor: "action.selected" }}
                    >
                      <TableCell className="rank" />
                      <TableCell>Your best</TableCell>
                      <TableCell>{formatScore(myTopScore.score)}</TableCell>
                      {leaderboardExpanded && (
                        <TableCell>
                          {difficultyLabel(myTopScore.difficulty)}
                        </TableCell>
                      )}
                    </TableRow>
                  )}
                  {!visibleScores && (
                    <TableRow>
                      <TableCell colSpan={scoreColumnCount}>
                        <Typography variant="body2" color="textSecondary">
                          Loading...
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleScores && visibleScores.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={scoreColumnCount}>
                        <Typography variant="body2" color="textSecondary">
                          {visibleBoardFailed
                            ? desktopApp
                              ? "Steam scores are unavailable. You can still play and save offline."
                              : "Couldn't load the high scores right now."
                            : "Complete this mission to join the leaderboard"}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleScores &&
                    visibleScores.map((score: ScoreType, i: number) => {
                      const mine = Boolean(uid) && score.uid === uid;
                      return (
                        <TableRow
                          key={i}
                          sx={
                            mine
                              ? {
                                  fontWeight: 600,
                                  bgcolor: "action.selected",
                                }
                              : undefined
                          }
                        >
                          <TableCell className="rank">{i + 1}</TableCell>
                          {/* Scores set before display names existed carry no name */}
                          <TableCell>
                            {score.displayName || "Anonymous"}
                          </TableCell>
                          <TableCell>{formatScore(score.score)}</TableCell>
                          {leaderboardExpanded && (
                            <TableCell>
                              {difficultyLabel(score.difficulty)}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
              {scores !== undefined && (
                <div className="leaderboardToggle">
                  <Button size="small" onClick={() => this.toggleLeaderboard()}>
                    {leaderboardExpanded ? "Show top 3" : "View all scores"}
                  </Button>
                </div>
              )}
            </div>
          )}
          {/* Below the board rather than in place of it: the board is the reason to log in */}
          {!challenge && !uid && !desktopApp && (
            <div
              style={{
                textAlign: "center",
                margin: "12px 0 24px",
                display: "grid",
                justifyItems: "center",
                gap: 8,
              }}
            >
              <SignInButtons />
              <Typography variant="body2" color="textSecondary">
                To set a high score under your own name
              </Typography>
            </div>
          )}
        </div>
      </ScreenPage>
    );
  }
}
