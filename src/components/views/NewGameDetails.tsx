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
} from "@mui/material";
import ArrowBackIosIcon from "@mui/icons-material/ArrowBackIos";
import CloseIcon from "@mui/icons-material/Close";
import InfoIcon from "@mui/icons-material/Info";
import PlayCircleIcon from "@mui/icons-material/PlayCircleOutlined";
import CircularProgress from "@mui/material/CircularProgress";
import VictoryConditions from "../base/VictoryConditions";
import { DIFFICULTIES } from "../../Constants";
import { getDb, login } from "../../Globals";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import { decodeReplay } from "../../Replay";
import {
  DifficultyType,
  GameType,
  LocationType,
  ReplayType,
  ScenarioType,
  ScoreType,
} from "../../Types";

import numbro from "numbro";

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
  scenario: ScenarioType | null;
  location: LocationType | null;
  victoryDialogOpen?: boolean;
  // The replay currently being fetched, so its row can show a spinner instead of the play button
  loadingReplayId?: string;
}

export interface Props extends StateProps, DispatchProps {}

export default class NewGameDetails extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const scenario =
      getScenario(props.game.scenarioId, props.game.customScenario) || null;
    this.state = {
      scenario,
      location: getScenarioLocation(scenario) || null,
    };
    if (props.uid) {
      this.loadScores(props.uid);
    }
  }

  private async loadScores(uid: string) {
    if (this.state.scenario && uid) {
      const db = getDb();
      // Tracked synchronously here because React state updates are async
      let scores: ScoreType[] = [];

      let q = query(
        collection(db, "scores"),
        where("scenarioId", "==", this.state.scenario.id),
        orderBy("score", "desc"),
        limit(50),
      );
      let querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc) => {
        scores = [...scores, doc.data() as ScoreType];
        this.setState({ scores });
      });

      q = query(
        collection(db, "scores"),
        where("scenarioId", "==", this.state.scenario.id),
        where("uid", "==", uid),
        orderBy("score", "desc"),
        limit(1),
      );
      querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc) => {
        this.setState({ myTopScore: doc.data() as ScoreType });
      });
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
      const replay = snapshot.exists() ? decodeReplay(snapshot.data()) : null;
      if (replay) {
        this.props.onWatchReplay(replay);
      } else {
        this.props.onReplayError("Sorry, that replay couldn't be loaded.");
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
      return <TableCell padding="none" />;
    }
    const replayId = score.replayId;
    if (this.state.loadingReplayId === replayId) {
      return (
        <TableCell padding="none">
          <CircularProgress size={20} />
        </TableCell>
      );
    }
    return (
      <TableCell padding="none">
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

  public shouldComponentUpdate(nextProps: Props) {
    if (!this.props.uid && nextProps.uid) {
      this.loadScores(nextProps.uid);
    }
    return true;
  }

  public render() {
    const { onBack, onDelta, onStart, game, uid } = this.props;
    const { scenario, scores, myTopScore, location, victoryDialogOpen } =
      this.state;

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

    return (
      <div id="listCard">
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
            <Typography variant="h6">{scenario.name}</Typography>
          </Toolbar>
        </div>
        <div
          style={{ textAlign: "center", margin: "20px 0", lineHeight: "30px" }}
        >
          Victory Conditions: {scenario.ownership}-Owned
          <IconButton
            onClick={toggleVictoryDialog}
            aria-label="Victory conditions"
            color="primary"
            size="small"
          >
            <InfoIcon />
          </IconButton>
          <br />
          Timeframe: {scenario.startingYear} to{" "}
          {scenario.startingYear + Math.floor(scenario.durationMonths / 12)}
          <br />
          Location: {location.name}
          <br />
          Difficulty:&nbsp;
          <Select
            value={game.difficulty}
            onChange={(e: SelectChangeEvent<DifficultyType>) =>
              onDelta({ difficulty: e.target.value as DifficultyType })
            }
          >
            {Object.keys(DIFFICULTIES).map((d: string) => {
              return (
                <MenuItem value={d} key={d}>
                  <Tooltip
                    title={DIFFICULTIES[d].description}
                    placement="right"
                  >
                    <span>{d}</span>
                  </Tooltip>
                </MenuItem>
              );
            })}
          </Select>
        </div>

        <div style={{ textAlign: "center" }}>
          <Button
            size="large"
            variant="contained"
            color="primary"
            onClick={() => onStart(scenario.id)}
            autoFocus
          >
            Play
          </Button>
        </div>

        <Dialog open={victoryDialogOpen || false} onClose={toggleVictoryDialog}>
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

        <Table id="HighScores">
          <TableHead>
            <TableRow>
              <TableCell colSpan={3}>
                <Typography variant="h6">Global High Scores</Typography>
              </TableCell>
            </TableRow>
            {uid && (
              <TableRow>
                <TableCell>Score</TableCell>
                <TableCell>Difficulty</TableCell>
                <TableCell padding="none">Replay</TableCell>
              </TableRow>
            )}
          </TableHead>
          {!uid && (
            <TableBody>
              <TableRow>
                <TableCell colSpan={3} style={{ textAlign: "center" }}>
                  <Button variant="outlined" color="primary" onClick={login}>
                    Log in
                  </Button>
                  <Typography variant="body2" color="textSecondary">
                    To view and set high scores
                  </Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          )}
          {uid && (
            <TableBody>
              {myTopScore && (
                <TableRow style={{ fontWeight: "bold", background: "#eee" }}>
                  <TableCell>
                    Your best:{" "}
                    {numbro(myTopScore.score).format({
                      thousandSeparated: true,
                      mantissa: 0,
                    })}
                  </TableCell>
                  <TableCell>{myTopScore.difficulty}</TableCell>
                  {this.renderReplayCell(myTopScore)}
                </TableRow>
              )}
              {!scores && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="textSecondary">
                      Loading...
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {scores && scores.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="textSecondary">
                      Play the scenario to set a high score
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {scores &&
                scores.map((score: ScoreType, i: number) => {
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        {numbro(score.score).format({
                          thousandSeparated: true,
                          mantissa: 0,
                        })}
                      </TableCell>
                      <TableCell>{score.difficulty}</TableCell>
                      {this.renderReplayCell(score)}
                    </TableRow>
                  );
                })}
            </TableBody>
          )}
        </Table>
      </div>
    );
  }
}
