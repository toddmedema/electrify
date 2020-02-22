import {Button, IconButton, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import * as React from 'react';

import {DIFFICULTIES} from 'app/Constants';
import {getDb} from 'app/Globals';
import {SCENARIOS} from 'app/Scenarios';
import {DifficultyType, GameStateType, ScenarioType, ScoreType} from 'app/Types';

const numbro = require('numbro');

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameStateType>) => void;
  onStart: (delta: Partial<GameStateType>) => void;
}

interface State {
  scores?: ScoreType[];
  scenario: ScenarioType | null;
}

export interface Props extends StateProps, DispatchProps {}

export default class extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      scenario: SCENARIOS.find((s) => s.id === props.gameState.scenarioId) || null,
    };
    const db = getDb();
    if (this.state.scenario) {
      db.collection('scores')
        .where('scenarioId', '==', this.state.scenario.id)
        .orderBy('score', 'desc')
        .limit(50)
        .get()
        .then((qs: any) => {
          this.setState({scores: []});
          qs.forEach((doc: any) => {
            this.setState({scores: [...(this.state.scores || []), doc.data()]});
          });
        });
    }
  }

  public render() {
    const {onBack, onDelta, onStart, gameState} = this.props;
    const {scenario, scores} = this.state;

    if (!scenario) {
      return <div>
        <IconButton onClick={onBack} aria-label="back" edge="start" color="primary">
          <ArrowBackIosIcon />
        </IconButton>
        UNKNOWN SCENARIO
      </div>;
    }

    return (
      <div id="listCard">
        <div id="topbar">
          <Toolbar>
            <IconButton onClick={onBack} aria-label="back" edge="start" color="primary">
              <ArrowBackIosIcon />
            </IconButton>
            <Typography variant="h6">{scenario.name}</Typography>
          </Toolbar>
        </div>
        <div style={{textAlign: 'center', margin: '20px 0', lineHeight: '30px'}}>
          Scenario timeframe: {scenario.startingYear} to {scenario.startingYear + Math.floor(scenario.durationMonths / 12)}<br/>
          Select difficulty:
          <Select
            value={gameState.difficulty}
            onChange={(e: any) => onDelta({ difficulty: e.target.value })}
          >
            {Object.keys(DIFFICULTIES).map((d: DifficultyType) => {
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
              <TableCell colSpan={3}><Typography variant="h6">High scores</Typography></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Score</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Difficulty</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(scores || []).map((score: ScoreType, i: number) => {
              return <TableRow key={i}>
                <TableCell>{numbro(score.score).format({thousandSeparated: true, mantissa: 0})}</TableCell>
                <TableCell>{score.username}</TableCell>
                <TableCell>{score.difficulty}</TableCell>
              </TableRow>;
            })}
            {!scores && <TableRow><TableCell colSpan={2}><Typography variant="body2" color="textSecondary">Loading...</Typography></TableCell></TableRow>}
            {scores && scores.length === 0 && <TableRow><TableCell colSpan={2}><Typography variant="body2" color="textSecondary">Play the scenario to set a high score</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    );
  }
}
