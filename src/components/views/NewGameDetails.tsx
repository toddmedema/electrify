import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { difficultyLockReason } from "../../achievements/DifficultyUnlocks";
import { activeScenario } from "../../helpers/GameSelectors";
import * as React from "react";
import {
  Button,
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
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import VictoryConditionsDialog from "../base/VictoryConditionsDialog";
import ConceptIcon from "../base/ConceptIcon";
import {
  DIFFICULTY_IDS,
  DIFFICULTY_LABELS,
  MONTHS,
  difficultyLabel,
} from "../../Constants";
import DifficultyPicker from "../base/DifficultyPicker";
import SignInButtons from "../base/SignInButtons";
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
import { BOARD_ROWS, loadLeaderboard } from "../../Leaderboard";

export interface StateProps {
  challenge?: ChallengeInvitation;
  onContinue?: () => void;
  game: GameType;
  unlockedThrough?: DifficultyType;
  uid?: string;
  /** Choosing with a co-op lobby: the host starts for everyone; guests mark Ready. */
  coop?: CoopSelectionType;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameType>) => void;
  onStart: (scenarioId: number) => void;
}

/** One difficulty's board. */
interface BoardType {
  scores: ScoreType[];
  // Tells "nobody has played this yet" apart from "the board couldn't be read"
  failed?: boolean;
}

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

interface State {
  // Public boards are eager; private bests are loaded as each difficulty is visited.
  boards: PerDifficulty<BoardType>;
  myBests: PerDifficulty<{ score?: ScoreType; failed?: boolean }>;
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
    // Keep the board's space while the boards reload or have fewer scores.
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
        scores: await loadLeaderboard(
          scenario.id,
          difficulty,
          this.state.steamScope || "global",
          this.props.uid,
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
      const allScores = await loadLeaderboard(
        scenario.id,
        undefined,
        this.state.steamScope || "global",
        this.props.uid,
      );
      if (requestId === this.allScoresRequestId) this.setState({ allScores });
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

  /** Only the selected level needs a private query; successful empty results are cached too. */
  private loadMyBests(uid: string) {
    if (!this.showsBoard() || !this.state.scenario) return;
    cancelRequests(this.myBestRequestIds);
    this.setState({ myBests: {} });
    void this.loadMyBest(uid, this.props.game.difficulty);
  }

  private async loadMyBest(uid: string, difficulty: DifficultyType) {
    const scenario = this.state.scenario;
    if (!scenario || !this.showsBoard()) return;
    const requestId = nextRequest(this.myBestRequestIds, difficulty);
    let best: { score?: ScoreType; failed?: boolean };
    try {
      best = {
        score: (
          await loadLeaderboard(scenario.id, difficulty, "player", uid)
        )[0],
      };
    } catch (err) {
      console.warn("Couldn't load your best score: ", err);
      best = { failed: true };
    }
    if (
      requestId === this.myBestRequestIds[difficulty] &&
      this.props.uid === uid
    )
      this.setState((state) => ({
        myBests: { ...state.myBests, [difficulty]: best },
      }));
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
   * The board's height just before a difficulty switch swaps its rows: afterwards the
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
      cancelRequests(this.boardRequestIds);
      cancelRequests(this.myBestRequestIds);
      ++this.allScoresRequestId;
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
          allScores: undefined,
          allScoresFailed: false,
        },
        () => {
          this.loadBoards();
          if (this.state.leaderboardExpanded) void this.loadAllScores();
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
      if (
        this.props.uid &&
        (!this.state.myBests[difficulty] ||
          this.state.myBests[difficulty]?.failed)
      )
        void this.loadMyBest(this.props.uid, difficulty);
      if (this.showsBoard() && this.state.boards[difficulty]?.failed) {
        this.retryBoard(difficulty);
      }
      if (boardHeight && boardHeight > (this.state.leaderboardMinHeight || 0)) {
        this.setState({ leaderboardMinHeight: boardHeight });
      }
    }
    // Logging in from the button below the board is what makes "your best" answerable
    if (
      this.props.uid !== prevProps.uid &&
      process.env.REACT_APP_DESKTOP === "true" &&
      isDesktopApp()
    ) {
      cancelRequests(this.boardRequestIds);
      ++this.allScoresRequestId;
      this.loadBoards();
      if (this.state.leaderboardExpanded) void this.loadAllScores();
    }
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

    const challengeLock =
      challenge && this.props.unlockedThrough
        ? difficultyLockReason(game.difficulty, this.props.unlockedThrough)
        : undefined;
    const endYear =
      scenario.startingYear +
      Math.floor(
        ((scenario.startingMonth ?? 1) - 1 + scenario.durationMonths - 1) / 12,
      );
    // Public boards are eager; a visited difficulty keeps its own personal best.
    const scores = boards[game.difficulty]?.scores;
    const boardFailed = boards[game.difficulty]?.failed;
    const myTopScore = myBests[game.difficulty]?.score;
    const visibleScores = leaderboardExpanded
      ? allScores
      : scores?.slice(0, BOARD_ROWS);
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
                {location.name} ·{" "}
                {scenario.startingMonth
                  ? `${MONTHS[scenario.startingMonth - 1]} `
                  : ""}
                {scenario.startingYear}–
                {scenario.startingMonth
                  ? `${MONTHS[(scenario.startingMonth - 1 + scenario.durationMonths - 1) % 12]} `
                  : ""}
                {endYear}
              </Typography>
              {scenario.summary && (
                <Typography variant="body1" color="textSecondary">
                  {scenario.summary}
                </Typography>
              )}
              <div className="scenarioBriefing">
                <Button
                  startIcon={<InfoOutlinedIcon />}
                  onClick={toggleVictoryDialog}
                >
                  Goals and scoring
                </Button>
                {scenario.threat && (
                  <div className="scenarioWatchOut" role="note">
                    <ConceptIcon concept="danger" fontSize="small" />
                    <div>
                      <Typography variant="overline" component="div">
                        Watch out
                      </Typography>
                      <Typography variant="body2">{scenario.threat}</Typography>
                    </div>
                  </div>
                )}
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
                      scenario={scenario}
                      variant="toggle"
                      showDescription
                      value={game.difficulty}
                      onChange={(difficulty) => onDelta({ difficulty })}
                      readOnly={coop?.role === "guest"}
                      unlockedThrough={this.props.unlockedThrough}
                    />
                  </div>
                )}
                {challengeLock && (
                  <Typography
                    role="status"
                    variant="body2"
                    color="text.secondary"
                  >
                    <LockOutlinedIcon
                      fontSize="small"
                      sx={{ verticalAlign: "middle", mr: 0.5 }}
                    />
                    {challengeLock}
                  </Typography>
                )}
                {this.props.challenge && (
                  <Typography variant="body2" color="text.secondary">
                    {reliabilityRuleText(game.difficulty, scenario)}
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
                    disabled={!!challengeLock}
                    startIcon={
                      challengeLock ? <LockOutlinedIcon /> : <PlayCircleIcon />
                    }
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
                      <Typography
                        id="leaderboard-title"
                        component="h2"
                        variant="h6"
                      >
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
                  {uid && !myBests[game.difficulty] && (
                    <TableRow>
                      <TableCell colSpan={scoreColumnCount} role="status">
                        Loading your best…
                      </TableCell>
                    </TableRow>
                  )}
                  {uid && myBests[game.difficulty]?.failed && (
                    <TableRow>
                      <TableCell colSpan={scoreColumnCount}>
                        <Button
                          onClick={() => {
                            this.setState((state) => {
                              const myBests = { ...state.myBests };
                              delete myBests[game.difficulty];
                              return { myBests };
                            });
                            void this.loadMyBest(uid, game.difficulty);
                          }}
                        >
                          Retry your best score
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
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
                    {leaderboardExpanded
                      ? "Show this level"
                      : "View all scores"}
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
