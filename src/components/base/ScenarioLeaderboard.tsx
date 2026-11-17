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
import {
  DIFFICULTY_IDS,
  DIFFICULTY_LABELS,
  difficultyLabel,
} from "../../Constants";
import { DifficultyType, ScoreType } from "../../Types";
import { BOARD_ROWS, loadLeaderboard } from "../../Leaderboard";
import { formatScore } from "../../helpers/Format";
import { isDesktopApp } from "../../Desktop";
import SignInButtons from "./SignInButtons";

interface Props {
  scenarioId: number;
  difficulty: DifficultyType;
  uid?: string;
  emptyMessage?: string;
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
  leaderboardExpanded?: boolean;
  leaderboardMinHeight?: number;
  steamScope?: SteamScope;
}

/** The same public boards and personal bests for missions and the full campaign. */
export default class ScenarioLeaderboard extends React.Component<Props, State> {
  private boardRequestIds: PerDifficulty<number> = {};
  private myBestRequestIds: PerDifficulty<number> = {};
  private allScoresRequestId = 0;
  private leaderboardRef = React.createRef<HTMLDivElement>();
  state: State = { boards: {}, myBests: {} };

  /** The selected difficulty first, so it is the first query out and the first answered. */
  private difficultiesSelectedFirst(): DifficultyType[] {
    const selected = this.props.difficulty;
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
    const requestId = nextRequest(this.boardRequestIds, difficulty);
    let board: BoardType;
    try {
      board = {
        scores: await loadLeaderboard(
          this.props.scenarioId,
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
    const requestId = ++this.allScoresRequestId;
    this.setState({ allScores: undefined, allScoresFailed: false });
    try {
      const allScores = await loadLeaderboard(
        this.props.scenarioId,
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
    cancelRequests(this.myBestRequestIds);
    this.setState({ myBests: {} });
    void this.loadMyBest(uid, this.props.difficulty);
  }

  private async loadMyBest(uid: string, difficulty: DifficultyType) {
    const requestId = nextRequest(this.myBestRequestIds, difficulty);
    let best: { score?: ScoreType; failed?: boolean };
    try {
      best = {
        score: (
          await loadLeaderboard(
            this.props.scenarioId,
            difficulty,
            "player",
            uid,
          )
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
    this.loadBoards();
    if (this.props.uid) this.loadMyBests(this.props.uid);
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
      this.props.difficulty === prevProps.difficulty ||
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
    if (this.props.scenarioId !== prevProps.scenarioId) {
      cancelRequests(this.boardRequestIds);
      cancelRequests(this.myBestRequestIds);
      ++this.allScoresRequestId;
      this.setState(
        {
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
    if (this.props.difficulty !== prevProps.difficulty) {
      // Every board is already loaded or on its way, so this is a lookup. Only a board that
      // couldn't be read is asked for again.
      const { difficulty } = this.props;
      if (
        this.props.uid &&
        (!this.state.myBests[difficulty] ||
          this.state.myBests[difficulty]?.failed)
      )
        void this.loadMyBest(this.props.uid, difficulty);
      if (this.state.boards[difficulty]?.failed) {
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
    const { difficulty, uid, emptyMessage } = this.props;
    const {
      boards,
      myBests,
      allScores,
      allScoresFailed,
      leaderboardExpanded,
      leaderboardMinHeight,
    } = this.state;
    // Public boards are eager; a visited difficulty keeps its own personal best.
    const scores = boards[difficulty]?.scores;
    const boardFailed = boards[difficulty]?.failed;
    const myTopScore = myBests[difficulty]?.score;
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
      <>
        <div
          className="leaderboard"
          role="region"
          aria-labelledby="leaderboard-title"
          ref={this.leaderboardRef}
          style={{
            minHeight: leaderboardExpanded ? undefined : leaderboardMinHeight,
          }}
        >
          {desktopApp && (
            <ToggleButtonGroup
              exclusive
              value={this.state.steamScope || "global"}
              aria-label="Steam leaderboard"
              size="small"
              sx={{ m: 1.5 }}
              onChange={(_event, steamScope: "global" | "friends" | null) => {
                if (!steamScope) return;
                ++this.allScoresRequestId;
                this.setState({ steamScope, allScores: undefined }, () => {
                  this.loadBoards();
                  if (this.state.leaderboardExpanded) void this.loadAllScores();
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
                      : `Leaderboard — ${DIFFICULTY_LABELS[difficulty]}`}
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
              {uid && !myBests[difficulty] && (
                <TableRow>
                  <TableCell colSpan={scoreColumnCount} role="status">
                    Loading your best…
                  </TableCell>
                </TableRow>
              )}
              {uid && myBests[difficulty]?.failed && (
                <TableRow>
                  <TableCell colSpan={scoreColumnCount}>
                    <Button
                      onClick={() => {
                        this.setState((state) => {
                          const myBests = { ...state.myBests };
                          delete myBests[difficulty];
                          return { myBests };
                        });
                        void this.loadMyBest(uid, difficulty);
                      }}
                    >
                      Retry your best score
                    </Button>
                  </TableCell>
                </TableRow>
              )}
              {myTopScore && (
                <TableRow sx={{ fontWeight: 600, bgcolor: "action.selected" }}>
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
                        : emptyMessage ||
                          "Complete this mission to join the leaderboard"}
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
                      <TableCell>{score.displayName || "Anonymous"}</TableCell>
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
                {leaderboardExpanded ? "Show this level" : "View all scores"}
              </Button>
            </div>
          )}
        </div>
        {/* Below the board rather than in place of it: the board is the reason to log in */}
        {!uid && !desktopApp && (
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
      </>
    );
  }
}
