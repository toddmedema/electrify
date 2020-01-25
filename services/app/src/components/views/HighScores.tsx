import {IconButton, Table, TableBody, TableCell, TableHead, TableRow, Toolbar, Typography} from '@material-ui/core';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import * as React from 'react';

import {ScoresContainerType, ScoreType} from 'app/Types';
import {getStorageJson} from '../../LocalStorage';

const numbro = require('numbro');

export interface StateProps {
}

export interface DispatchProps {
  onBack: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export default class HighScores extends React.PureComponent<Props, {}> {
  public render() {

  const scores = (getStorageJson('highscores', {scores: []}) as ScoresContainerType).scores.sort((a, b) => a.score < b.score ? 1 : -1);

  return (
      <div className="flexContainer" id="gameCard">
        <div id="topbar">
          <Toolbar>
            <IconButton onClick={this.props.onBack} aria-label="back" edge="start" color="primary">
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h6">Your High Scores</Typography>
          </Toolbar>
        </div>
        <div className="scrollable">
          <Table id="HighScores">
            <TableHead>
              <TableRow>
                <TableCell>Score</TableCell>
                <TableCell>Difficulty</TableCell>
                <TableCell>Scenario ID</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {scores.map((score: ScoreType, i: number) => {
                return <TableRow key={i}>
                  <TableCell>{numbro(score.score).format({thousandSeparated: true, mantissa: 0})}</TableCell>
                  <TableCell>{score.difficulty}</TableCell>
                  <TableCell>{score.scenarioId}</TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }
}
