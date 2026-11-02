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
import {
  DIFFICULTY_IDS,
  DIFFICULTY_LABELS,
  difficultyLabel,
} from "../../Constants";
import DifficultyPicker from "../base/DifficultyPicker";
import { getDb, login } from "../../Globals";
import GoogleSignIn from "../base/GoogleSignIn";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import CoopBrowseBar, { CoopStartButton } from "../base/CoopBrowseBar";
import {
  ChallengeInvitation,
  CoopSelectionType,
  DifficultyType,
  GameType,
  LocationType,
  ScenarioType,
  ScoreType,
} from "../../Types";

import { formatScore } from "../../helpers/Format";
import { isDesktopApp } from "../../Desktop";
import { reliabilityRuleText } from "../../helpers/ObjectiveRules";
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

/** One difficulty's compact board. */
interface BoardType {
  scores: ScoreType[];
  // Tells "nobody has played this yet" apart from "the board couldn't be read"
  failed?: boolean;
}

/**
 * The compact board shows only this many rows (the expanded view has its own query), so this is
 * all that is read for each of the difficulties prefetched below.
 */
const COMPACT_BOARD_ROWS = 3;

type SteamScope = "global" | "friends";

type PerDifficulty<T> = Partial<Record<DifficultyType, T>>;

/** Count a new request for this difficulty, which makes any earlier one stale. */
function nextRequest(
  ids: PerDifficulty<number>,
  difficulty: DifficultyType,
): number {
  return (ids[difficulty] = (ids[difficulty] || 0) + 1);
}

function cancelRequests(ids: PerDifficulty<number>) {
  for (const difficulty of DIFFICULTY_IDS) nextRequest(ids, difficulty);
}

/** The top of one difficulty's board. Throws if it can't be read. */
async function fetchBoard(
  scenarioId: number,
  difficulty: DifficultyType,
  scope: SteamScope,
): Promise<ScoreType[]> {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
    const { desktopScores } = await import("../../DesktopScores");
    return desktopScores(scenarioId, difficulty, scope, COMPACT_BOARD_ROWS);
  }
  const querySnapshot = await getDocs(
    query(
      collection(getDb(), "scores"),
      where("scoreVersion", "==", SCORE_VERSION),
      where("outcome", "==", "completed"),
      where("scenarioId", "==", scenarioId),
      where("difficulty", "==", difficulty),
      orderBy("score", "desc"),
      limit(COMPACT_BOARD_ROWS),
    ),
  );
  return querySnapshot.docs.map((doc) => doc.data() as ScoreType);
}

/** The player's own best at one difficulty, if they have completed it. */
async function fetchMyBest(
  scenarioId: number,
  difficulty: DifficultyType,
  uid: string,
): Promise<ScoreType | undefined> {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
    const { desktopScores } = await import("../../DesktopScores");
    return (await desktopScores(scenarioId, difficulty, "player"))[0];
  }
  const querySnapshot = await getDocs(
    query(
      collection(getDb(), "scores"),
      where("scoreVersion", "==", SCORE_VERSION),
      where("outcome", "==", "completed"),
      where("scenarioId", "==", scenarioId),
      where("difficulty", "==", difficulty),
      where("uid", "==", uid),
      orderBy("score", "desc"),
      limit(1),
    ),
  );
  return querySnapshot.docs[0]?.data() as ScoreType | undefined;
}

interface State {
  // Every difficulty's board and the player's best at it, read up front and keyed by difficulty
  // so that switching difficulty is a lookup rather than a wait. A missing board is still loading.
  boards: PerDifficulty<BoardType>;
  myBests: PerDifficulty<ScoreType>;
  allScores?: ScoreType[];
  allScoresFailed?: boolean;
  scenario: ScenarioType | null;
  location: LocationType | null;
  victoryDialogOpen?: boolean;
  leaderboardExpanded?: boolean;
  leaderboardMinHeight?: number;
  steamScope?: SteamScope;
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
  // Per difficulty, so that retrying one board can't strand the others
  private boardRequestIds: PerDifficulty<number> = {};
  private myBestRequestIds: PerDifficulty<number> = {};
  private allScoresRequestId = 0;
  private leaderboardRef = React.createRef<HTMLDivElement>();

  constructor(props: Props) {
    super(props);
    const scenario = activeScenario(props.game) || null;
    this.state = {
      boards: {},
      myBests: {},
      scenario,
      location: getScenarioLocation(scenario) || null,
    };
  }

  /** Friend challenges and co-op lobbies don't show the board, so they don't read it either. */
  private showsBoard(props: Props = this.props) {
    return !props.challenge && !props.coop;
  }

  /** The selected difficulty first, so it is the first query out and the first answered. */
  private difficultiesSelectedFirst(): DifficultyType[] {
    const selected = this.props.game.difficulty;
    return [selected, ...DIFFICULTY_IDS.filter((id) => id !== selected)];
  }

  /**
   * The boards themselves, which are public -- anyone can read them, logged in or not. Seeing
   * named strangers above you is the reason to sign up, so hiding them behind a login inverted the
   * very incentive they exist to create.
   *
   * Every difficulty is read at once, so that choosing another one shows its board straight away
   * instead of pausing on "Loading...". Each answer lands on its own: one that fails or is slow
   * affects only its difficulty.
   */
  private loadBoards() {
    if (!this.showsBoard() || !this.state.scenario) return;
    // Keep the compact board's space while the boards reload or have fewer scores.
    // Collapsing it briefly clamps the scroller and moves the difficulty buttons above it.
    const leaderboardMinHeight = this.state.leaderboardExpanded
      ? this.state.leaderboardMinHeight
      : Math.max(
          this.state.leaderboardMinHeight || 0,
          this.leaderboardRef.current?.getBoundingClientRect().height || 0,
        );
    this.setState({ boards: {}, leaderboardMinHeight });
    for (const difficulty of this.difficultiesSelectedFirst()) {
      void this.loadBoard(difficulty);
    }
  }

  private async loadBoard(difficulty: DifficultyType) {
    const scenario = this.state.scenario;
    if (!scenario) {
      return;
    }
    const requestId = nextRequest(this.boardRequestIds, difficulty);
    let board: BoardType;
    try {
      board = {
        scores: await fetchBoard(
          scenario.id,
          difficulty,
          this.state.steamScope || "global",
        ),
      };
    } catch (err) {
      console.warn("Couldn't load the high scores: ", err);
      board = { scores: [], failed: true };
    }
    if (requestId === this.boardRequestIds[difficulty]) {
      this.setState((state) => ({
        boards: { ...state.boards, [difficulty]: board },
      }));
    }
  }

  /** Asks again for a board that couldn't be read, showing "Loading..." meanwhile. */
  private retryBoard(difficulty: DifficultyType) {
    this.setState((state) => {
      const boards = { ...state.boards };
      delete boards[difficulty];
      return { boards };
    });
    void this.loadBoard(difficulty);
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

  /**
   * The player's own best at every difficulty, which is the one row worth showing above the rest.
   * Read up front like the boards, so that "Your best" doesn't disappear when the difficulty
   * changes.
   */
  private loadMyBests(uid: string) {
    if (!this.showsBoard() || !this.state.scenario) return;
    this.setState({ myBests: {} });
    for (const difficulty of this.difficultiesSelectedFirst()) {
      void this.loadMyBest(uid, difficulty);
    }
  }

  private async loadMyBest(uid: string, difficulty: DifficultyType) {
    const scenario = this.state.scenario;
    if (!scenario) {
      return;
    }
    const requestId = nextRequest(this.myBestRequestIds, difficulty);
    try {
      const best = await fetchMyBest(scenario.id, difficulty, uid);
      if (best && requestId === this.myBestRequestIds[difficulty]) {
        this.setState((state) => ({
          myBests: { ...state.myBests, [difficulty]: best },
        }));
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
    this.loadBoards();
    if (this.props.uid) {
      this.loadMyBests(this.props.uid);
    }
  }

  public componentWillUnmount() {
    cancelRequests(this.boardRequestIds);
    cancelRequests(this.myBestRequestIds);
    ++this.allScoresRequestId;
  }

  /**
   * The compact board's height just before a difficulty switch swaps its rows: afterwards the
   * DOM already shows the new difficulty, which may have fewer scores.
   */
  public getSnapshotBeforeUpdate(prevProps: Props): number | null {
    if (
      this.props.game.difficulty === prevProps.game.difficulty ||
      this.state.leaderboardExpanded
    )
      return null;
    return this.leaderboardRef.current?.getBoundingClientRect().height || null;
  }

  public componentDidUpdate(
    prevProps: Props,
    _prevState: State,
    boardHeight: number | null,
  ) {
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
        () => {
          this.loadBoards();
          if (this.props.uid) this.loadMyBests(this.props.uid);
        },
      );
      return;
    }
    if (this.showsBoard() && !this.showsBoard(prevProps)) {
      // Whatever was read while a lobby or challenge hid the board may be for another scenario
      this.loadBoards();
      if (this.props.uid) this.loadMyBests(this.props.uid);
      return;
    }
    if (this.props.game.difficulty !== prevProps.game.difficulty) {
      // Every board is already loaded or on its way, so this is a lookup. Only a board that
      // couldn't be read is asked for again.
      const { difficulty } = this.props.game;
      if (this.showsBoard() && this.state.boards[difficulty]?.failed) {
        this.retryBoard(difficulty);
      }
      if (boardHeight && boardHeight > (this.state.leaderboardMinHeight || 0)) {
        this.setState({ leaderboardMinHeight: boardHeight });
      }
    }
    // Logging in from the button below the board is what makes "your best" answerable
    if (this.props.uid && this.props.uid !== prevProps.uid) {
      this.loadMyBests(this.props.uid);
    } else if (!this.props.uid && prevProps.uid) {
      cancelRequests(this.myBestRequestIds);
      this.setState({ myBests: {} });
    }
  }

  public render() {
    const { onBack, onDelta, onStart, game, uid, challenge, onContinue, coop } =
      this.props;
    const {
      scenario,
      boards,
      myBests,
      location,
      victoryDialogOpen,
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
    // The selected difficulty's board and best come straight from what was read up front
    const scores = boards[game.difficulty]?.scores;
    const boardFailed = boards[game.difficulty]?.failed;
    const myTopScore = myBests[game.difficulty];
    const visibleScores = leaderboardExpanded
      ? allScores
      : scores?.slice(0, COMPACT_BOARD_ROWS);
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
                      aria-label="Goals"
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
                {this.props.challenge && (
                  <Typography variant="body2" color="text.secondary">
                    {reliabilityRuleText(game.difficulty)}
                  </Typography>
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
            title="Goals"
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
                      this.loadBoards();
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
            <div style={{ textAlign: "center", margin: "12px 0 24px" }}>
              <GoogleSignIn centered onSignIn={login} />
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
