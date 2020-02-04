import {Button, IconButton, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import * as React from 'react';

import {DIFFICULTIES} from 'app/Constants';
import {SCENARIOS} from 'app/Scenarios';
import {DifficultyType, GameStateType, ScoresContainerType, ScoreType} from 'app/Types';
import {getStorageJson} from '../../LocalStorage';

const numbro = require('numbro');

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onDelta: (delta: Partial<GameStateType>) => void;
  onStart: (delta: Partial<GameStateType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function NewGameDetails(props: Props): JSX.Element {
  const scenario = SCENARIOS.find((s) => s.id === props.gameState.scenarioId) || null;
  const scores = (getStorageJson('highscores', {scores: []}) as ScoresContainerType).scores
    .filter((s) => s.scenarioId === props.gameState.scenarioId)
    .sort((a, b) => a.score < b.score ? 1 : -1);

  if (!scenario) {
    return <div>
      <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
        <ArrowBackIosIcon />
      </IconButton>
      UNKNOWN SCENARIO
    </div>;
  }

  return (
    <div id="listCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">{scenario.name}</Typography>
        </Toolbar>
      </div>
      <div style={{textAlign: 'center', margin: '20px 0', lineHeight: '30px'}}>
        Scenario timeframe: {scenario.startingYear} to {scenario.startingYear + Math.floor(scenario.durationMonths / 12)}<br/>
        Select difficulty:
        <Select
          value={props.gameState.difficulty}
          onChange={(e: any) => props.onDelta({ difficulty: e.target.value })}
        >
          {Object.keys(DIFFICULTIES).map((d: DifficultyType) => {
            return <MenuItem value={d} key={d}>{d}</MenuItem>;
          })}
        </Select>
      </div>

      <div style={{textAlign: 'center'}}>
        <Button size="large" variant="contained" color="primary" onClick={() => props.onStart({})} autoFocus>Play</Button>
      </div>

      <Table id="HighScores">
        <TableHead>
          <TableRow>
            <TableCell colSpan={2}><Typography variant="h6">Your scores</Typography></TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Score</TableCell>
            <TableCell>Difficulty</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {scores.map((score: ScoreType, i: number) => {
            return <TableRow key={i}>
              <TableCell>{numbro(score.score).format({thousandSeparated: true, mantissa: 0})}</TableCell>
              <TableCell>{score.difficulty}</TableCell>
            </TableRow>;
          })}
          {scores.length === 0 && <TableRow><TableCell colSpan={2}><Typography variant="body2" color="textSecondary">Play the scenario to set a high score</Typography></TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
