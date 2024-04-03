import * as React from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import {Button, IconButton, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Toolbar, Typography} from '@mui/material';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import {DIFFICULTIES, LOCATIONS} from '../../Constants';
import {getDb, login} from '../../Globals';
import {SCENARIOS} from '../../Scenarios';
import {GameType, LocationType, ScenarioType, ScoreType} from '../../Types';

const numbro = require('numbro');

export interface StateProps {
  game: GameType;
  uid?: string;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameType>) => void;
  onStart: (delta: Partial<GameType>) => void;
}

interface State {
  scores?: ScoreType[];
  myTopScore?: ScoreType;
  scenario: ScenarioType | null;
  location: LocationType | null;
}

export interface Props extends StateProps, DispatchProps {}

export default class NewGameDetails extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    const scenario = SCENARIOS.find((s) => s.id === props.game.scenarioId) || null;
    this.state = {
      scenario,
      location: scenario ? (LOCATIONS.find((s) => s.id === scenario.locationId) || null) : null,
    };
    this.loadScores(props.uid);
  }

  private async loadScores(uid: string|undefined) {
    if (this.state.scenario && uid) {
      const db = getDb();
      let scores = [] as any; // tracking here synchronously because React state updates are async
      this.setState({scores: [], myTopScore: undefined});

      let q = query(collection(db, 'scores'), where('scenarioId', '==', this.state.scenario.id), orderBy('score', 'desc'), limit(50));
      let querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc: any) => {
        scores = [...(scores || []), doc.data()];
        this.setState({scores});
      });

      q = query(collection(db, 'scores'), where('scenarioId', '==', this.state.scenario.id), where('uid', '==', uid), orderBy('score', 'desc'), limit(1));
      querySnapshot = await getDocs(q);
      querySnapshot.forEach((doc: any) => {
        this.setState({myTopScore: doc.data()});
      });
    }
  }

  public shouldComponentUpdate(nextProps: Props, nextState: State) {
    if (!this.props.uid && nextProps.uid) {
      this.loadScores(nextProps.uid);
    }
    return true;
  }

  public render() {
    const {onBack, onDelta, onStart, game, uid} = this.props;
    const {scenario, scores, myTopScore, location} = this.state;

    if (!scenario || !location) {
      return (
        <div>
          <IconButton
            onClick={onBack}
            aria-label="back"
            edge="start"
            color="primary"
            size="large">
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
              size="large">
              <ArrowBackIosIcon />
            </IconButton>
            <Typography variant="h6">{scenario.name}</Typography>
          </Toolbar>
        </div>
        <div style={{textAlign: 'center', margin: '20px 0', lineHeight: '30px'}}>
          Scenario timeframe: {scenario.startingYear} to {scenario.startingYear + Math.floor(scenario.durationMonths / 12)}<br/>
          Scenario location: {location.name}<br/>
          Select difficulty:
          <Select
            value={game.difficulty}
            onChange={(e: any) => onDelta({ difficulty: e.target.value })}
          >
            {Object.keys(DIFFICULTIES).map((d: string) => {
              return <MenuItem value={d} key={d}>{d}</MenuItem>;
            })}
          </Select>
        </div>

        <div style={{textAlign: 'center'}}>
          <Button size="large" variant="contained" color="primary" onClick={() => onStart({})} autoFocus>Play</Button>
        </div>

        <Table id="HighScores">
          <TableHead>
            <TableRow>
              <TableCell colSpan={2}><Typography variant="h6">Global High Scores</Typography></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Score</TableCell>
              <TableCell>Difficulty</TableCell>
            </TableRow>
          </TableHead>
          {!uid && <TableBody>
            <TableRow><TableCell colSpan={2} style={{textAlign: 'center'}}>
              <Button variant="contained" color="primary" onClick={login}>Log in</Button>
              <Typography variant="body2" color="textSecondary">Required to see and set high scores</Typography>
            </TableCell></TableRow>
          </TableBody>}
          {uid && <TableBody>
            {myTopScore && <TableRow style={{fontWeight: 'bold', background: '#eee'}}>
              <TableCell>Your best: {numbro(myTopScore.score).format({thousandSeparated: true, mantissa: 0})}</TableCell>
              <TableCell>{myTopScore.difficulty}</TableCell>
            </TableRow>}
            {!scores && <TableRow><TableCell colSpan={2}><Typography variant="body2" color="textSecondary">Loading...</Typography></TableCell></TableRow>}
            {scores && scores.length === 0 && <TableRow><TableCell colSpan={2}><Typography variant="body2" color="textSecondary">Play the scenario to set a high score</Typography></TableCell></TableRow>}
            {scores && scores.map((score: ScoreType, i: number) => {
              return <TableRow key={i}>
                <TableCell>{numbro(score.score).format({thousandSeparated: true, mantissa: 0})}</TableCell>
                <TableCell>{score.difficulty}</TableCell>
              </TableRow>;
            })}
          </TableBody>}
        </Table>
      </div>
    );
  }
}
