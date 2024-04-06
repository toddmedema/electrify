import * as React from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import {Button, IconButton, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Toolbar, Typography, Dialog, DialogTitle, DialogContent, DialogActions} from '@mui/material';
import ArrowBackIosIcon from '@mui/icons-material/ArrowBackIos';
import CloseIcon from '@mui/icons-material/Close';
import InfoIcon from '@mui/icons-material/Info';
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
  victoryDialogOpen?: boolean;
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
    if (props.uid) {
      this.loadScores(props.uid);
    }
  }

  private async loadScores(uid: string) {
    if (this.state.scenario && uid) {
      const db = getDb();
      let scores = [] as any; // tracking here synchronously because React state updates are async

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
    const {scenario, scores, myTopScore, location, victoryDialogOpen} = this.state;

    const toggleVictoryDialog = (e: any) => {
      this.setState({victoryDialogOpen: !victoryDialogOpen});
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
          Victory Conditions: {scenario.ownership}-Owned<IconButton
            onClick={toggleVictoryDialog}
            aria-label="Victory conditions"
            color="primary"
            size="small">
            <InfoIcon />
          </IconButton><br/>
          Timeframe: {scenario.startingYear} to {scenario.startingYear + Math.floor(scenario.durationMonths / 12)}<br/>
          Location: {location.name}<br/>
          Difficulty:&nbsp;
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
              size="large"><CloseIcon /></IconButton>
          </DialogTitle>
          <DialogContent>
            {/* Scoring algorithm should also be updated in Game.tsx */}
            {scenario.ownership === 'Investor' && <div>
              <p>+40 pts for each $1B of net worth at the end</p>
              <p>+2 pts for every 100k customers at the end</p>
              <p>+1 pt for each TWh of electricity supplied</p>
              <p>-2 pts for each gigaton of greenhouse gas emissions</p>
              <p>-8 pts for each TWh of blackouts</p>
            </div>}
            {scenario.ownership === 'Public' && <div>
              <p>+10 pts for each TWh of electricity supplied</p>
              <p>-5 pts for each gigaton of greenhouse gas emissions</p>
              <p>-10 pts for each TWh of blackouts</p>
            </div>}
          </DialogContent>
          <DialogActions>
            <Button color="primary" variant="contained" onClick={(e: any) => { toggleVictoryDialog(e); }}>Close</Button>
          </DialogActions>
        </Dialog>

        <Table id="HighScores">
          <TableHead>
            <TableRow>
              <TableCell colSpan={2}><Typography variant="h6">Global High Scores</Typography></TableCell>
            </TableRow>
            {uid && <TableRow>
              <TableCell>Score</TableCell>
              <TableCell>Difficulty</TableCell>
            </TableRow>}
          </TableHead>
          {!uid && <TableBody>
            <TableRow><TableCell colSpan={2} style={{textAlign: 'center'}}>
              <Button variant="outlined" color="primary" onClick={login}>Log in</Button>
              <Typography variant="body2" color="textSecondary">To view and set high scores</Typography>
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
