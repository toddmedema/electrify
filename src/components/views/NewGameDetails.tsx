import * as React from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Select,
  SelectChangeEvent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Toolbar,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
} from "@mui/material";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import CloseIcon from "@mui/icons-material/Close";
import InfoIcon from "@mui/icons-material/Info";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import CircularProgress from "@mui/material/CircularProgress";
import VictoryConditions from "../base/VictoryConditions";
import ConceptIcon, { ConceptNameType } from "../base/ConceptIcon";
import ScenarioArtwork from "../base/ScenarioArtwork";
import { DIFFICULTIES } from "../../Constants";
import { getDb, login } from "../../Globals";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import { decodeReplay, replayVersionError } from "../../Replay";
import {
  DifficultyType,
  GameType,
  LocationType,
  ReplayType,
  ScenarioType,
  ScoreType,
} from "../../Types";

import numbro from "numbro";

const DIFFICULTY_LABELS: { [key: string]: string } = {
  Intern: "Beginner",
  Employee: "Easy",
  Manager: "Medium",
  VP: "Hard",
  CEO: "Expert",
};

function formatScore(score: number): string {
  return numbro(score).format({ thousandSeparated: true, mantissa: 0 });
}

export interface StateProps {
  game: GameType;
  uid?: string;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameType>) => void;
  onStart: (scenarioId: number) => void;
  onWatchReplay: (replay: ReplayType) => void;
  onReplayError: (message: string) => void;
}

interface State {
  scores?: ScoreType[];
  myTopScore?: ScoreType;
  // Tells "nobody has played this yet" apart from "the board couldn't be read"
  boardFailed?: boolean;
  scenario: ScenarioType | null;
  location: LocationType | null;
  victoryDialogOpen?: boolean;
  // The replay currently being fetched, so its row can show a spinner instead of the play button
  loadingReplayId?: string;
  leaderboardExpanded?: boolean;
}

export interface Props extends StateProps, DispatchProps {}

function BriefingFact(props: {
  concept: ConceptNameType;
  label: string;
  children: React.ReactNode;
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
    </div>
  );
}

export default class NewGameDetails extends React.Component<Props, State> {
  private boardRequestId = 0;
  private myBestRequestId = 0;

  constructor(props: Props) {
    super(props);
    const scenario =
      getScenario(props.game.scenarioId, props.game.customScenario) || null;
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
    const scenario = this.state.scenario;
    if (!scenario) {
      return;
    }
    const requestId = ++this.boardRequestId;
    const difficulty = this.props.game.difficulty;
    this.setState({ scores: undefined, boardFailed: false });
    try {
      const querySnapshot = await getDocs(
        query(
          collection(getDb(), "scores"),
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
      const querySnapshot = await getDocs(
        query(
          collection(getDb(), "scores"),
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

  /**
   * Fetches a replay and hands it to the game. Replays live in their own collection rather than
   * on the score, so opening a leaderboard costs fifty small documents and watching one costs a
   * single extra read -- the alternative downloads every replay to show a table of numbers.
   */
  private async watchReplay(replayId: string) {
    if (this.state.loadingReplayId) {
      return;
    }
    this.setState({ loadingReplayId: replayId });
    try {
      const snapshot = await getDoc(doc(getDb(), "replays", replayId));
      const data = snapshot.exists() ? snapshot.data() : undefined;
      const replay = data ? decodeReplay(data) : null;
      if (replay) {
        this.props.onWatchReplay(replay);
      } else {
        this.props.onReplayError(
          replayVersionError(data) || "Sorry, that replay couldn't be loaded.",
        );
      }
    } catch (err) {
      console.warn("Couldn't load the replay: ", err);
      this.props.onReplayError("Sorry, that replay couldn't be loaded.");
    } finally {
      this.setState({ loadingReplayId: undefined });
    }
  }

  private renderReplayCell(score: ScoreType) {
    if (!score.replayId) {
      return <TableCell className="replay" />;
    }
    const replayId = score.replayId;
    if (this.state.loadingReplayId === replayId) {
      return (
        <TableCell className="replay">
          <CircularProgress size={20} />
        </TableCell>
      );
    }
    return (
      <TableCell className="replay">
        <IconButton
          onClick={() => this.watchReplay(replayId)}
          aria-label="Watch replay"
          color="primary"
          size="small"
        >
          <PlayCircleIcon />
        </IconButton>
      </TableCell>
    );
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

  public componentDidUpdate(prevProps: Props) {
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
    const { onBack, onDelta, onStart, game, uid } = this.props;
    const {
      scenario,
      scores,
      myTopScore,
      location,
      victoryDialogOpen,
      boardFailed,
      leaderboardExpanded,
    } = this.state;

    const toggleVictoryDialog = (e: React.SyntheticEvent) => {
      this.setState({ victoryDialogOpen: !victoryDialogOpen });
      e.stopPropagation();
    };

    if (!scenario || !location) {
      return (
        <div>
          <IconButton
            onClick={onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large"
          >
            <ArrowBackIosIcon />
          </IconButton>
          UNKNOWN SCENARIO OR LOCATION
        </div>
      );
    }

    const briefing = scenario.briefing || {
      fantasy: scenario.summary || scenario.name,
      objective: "Keep the lights on and finish the term.",
      constraint: `${scenario.ownership}-owned scoring rewards a balanced grid.`,
      threat: "Blackouts and insolvency can end the run early.",
      target: "A reliable grid and a healthy company.",
    };
    const endYear =
      scenario.startingYear + Math.floor(scenario.durationMonths / 12);
    const visibleScores =
      scores && !leaderboardExpanded ? scores.slice(0, 3) : scores;

    return (
      <div id="listCard" className="flexContainer">
        <div id="topbar">
          <Toolbar>
            <IconButton
              onClick={onBack}
              aria-label="back"
              edge="start"
              color="primary"
              size="large"
            >
              <ArrowBackIosIcon />
            </IconButton>
            <Typography component="h1" variant="h6">
              {scenario.name}
            </Typography>
          </Toolbar>
        </div>
        <div className="scrollable">
          <section
            className="scenarioDossier"
            aria-labelledby="scenario-fantasy"
          >
            <ScenarioArtwork scenario={scenario} />
            <div className="scenarioDossierCopy">
              <Typography variant="overline" component="div">
                {location.name} · {scenario.startingYear}-{endYear} ·{" "}
                {scenario.durationMonths / 12} years
              </Typography>
              <Typography
                id="scenario-fantasy"
                variant="h4"
                component="h2"
                sx={{ fontWeight: 800, lineHeight: 1.1 }}
              >
                {briefing.fantasy}
              </Typography>
              <Typography variant="body1" color="textSecondary">
                {scenario.summary}
              </Typography>
              <div className="scenarioBriefingFacts">
                <BriefingFact concept="goal" label="Objective">
                  {briefing.objective}
                </BriefingFact>
                <BriefingFact concept="finances" label="Constraint">
                  {briefing.constraint}
                </BriefingFact>
                <BriefingFact concept="danger" label="Threat">
                  {briefing.threat}
                </BriefingFact>
              </div>
              <Box className="scenarioTarget">
                <ConceptIcon concept="supply" fontSize="small" />
                <div>
                  <Typography variant="overline" component="div">
                    Winning looks like
                  </Typography>
                  <Typography variant="body2">{briefing.target}</Typography>
                </div>
                <IconButton
                  onClick={toggleVictoryDialog}
                  aria-label="Victory conditions"
                  color="primary"
                  size="small"
                >
                  <InfoIcon />
                </IconButton>
              </Box>
              <Stack
                className="scenarioStartControls"
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ alignItems: { xs: "stretch", sm: "center" } }}
              >
                <div>
                  <Typography variant="caption" component="div">
                    Difficulty
                  </Typography>
                  <Select
                    value={game.difficulty}
                    size="small"
                    onChange={(e: SelectChangeEvent<DifficultyType>) =>
                      onDelta({ difficulty: e.target.value as DifficultyType })
                    }
                  >
                    {Object.keys(DIFFICULTIES).map((d: string) => (
                      <MenuItem value={d} key={d}>
                        <Tooltip
                          title={DIFFICULTIES[d].description}
                          placement="right"
                        >
                          <span>
                            {DIFFICULTY_LABELS[d]} ({d})
                          </span>
                        </Tooltip>
                      </MenuItem>
                    ))}
                  </Select>
                </div>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ flex: 1 }}
                >
                  {DIFFICULTIES[game.difficulty].description}
                </Typography>
                <Button
                  size="large"
                  variant="contained"
                  color="primary"
                  onClick={() => onStart(scenario.id)}
                  autoFocus
                  startIcon={<PlayCircleIcon />}
                >
                  Start mission
                </Button>
              </Stack>
            </div>
          </section>

          <Dialog
            open={victoryDialogOpen || false}
            onClose={toggleVictoryDialog}
          >
            <DialogTitle>
              Victory Conditions: {scenario.ownership}-Owned
              <IconButton
                aria-label="close"
                onClick={toggleVictoryDialog}
                className="top-right"
                size="large"
              >
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              <VictoryConditions
                ownership={scenario.ownership}
                dollarsPerkWh={scenario.dollarsPerkWh}
              />
            </DialogContent>
            <DialogActions>
              <Button
                color="primary"
                variant="contained"
                onClick={(e: React.MouseEvent<HTMLElement>) => {
                  toggleVictoryDialog(e);
                }}
              >
                Close
              </Button>
            </DialogActions>
          </Dialog>

          <div className="leaderboard">
            <Table id="HighScores">
              <TableHead>
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="h6">
                      Global High Scores — {DIFFICULTY_LABELS[game.difficulty]}
                    </Typography>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="rank">#</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Score</TableCell>
                  <TableCell className="replay">Replay</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {myTopScore && (
                  <TableRow
                    sx={{ fontWeight: "bold", bgcolor: "action.selected" }}
                  >
                    <TableCell className="rank" />
                    <TableCell>Your best</TableCell>
                    <TableCell>{formatScore(myTopScore.score)}</TableCell>
                    {this.renderReplayCell(myTopScore)}
                  </TableRow>
                )}
                {!scores && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="textSecondary">
                        Loading...
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {scores && scores.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="textSecondary">
                        {boardFailed
                          ? "Couldn't load the high scores right now."
                          : "Play the scenario to set a high score"}
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
                            ? { fontWeight: "bold", bgcolor: "action.selected" }
                            : undefined
                        }
                      >
                        <TableCell className="rank">{i + 1}</TableCell>
                        {/* Scores set before display names existed carry no name */}
                        <TableCell>
                          {score.displayName || "Anonymous"}
                        </TableCell>
                        <TableCell>{formatScore(score.score)}</TableCell>
                        {this.renderReplayCell(score)}
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            {scores && scores.length > 3 && (
              <div className="leaderboardToggle">
                <Button
                  size="small"
                  onClick={() =>
                    this.setState({ leaderboardExpanded: !leaderboardExpanded })
                  }
                >
                  {leaderboardExpanded
                    ? "Show top 3"
                    : `View all ${scores.length} scores`}
                </Button>
              </div>
            )}
          </div>
          {/* Below the board rather than in place of it: the board is the reason to log in */}
          {!uid && (
            <div style={{ textAlign: "center", margin: "12px 0 24px" }}>
              <Button variant="outlined" color="primary" onClick={login}>
                Sign in with Google
              </Button>
              <Typography variant="body2" color="textSecondary">
                To set a high score under your own name
              </Typography>
            </div>
          )}
        </div>
      </div>
    );
  }
}
