import { Button, FormControl, IconButton, InputLabel, MenuItem, Select, Toolbar, Typography } from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import InfoIcon from '@material-ui/icons/Info';
import * as React from 'react';

import { DIFFICULTIES } from 'app/Constants';
import { DifficultyType, GameStateType } from 'app/Types';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onStart: () => void;
  onDelta: (delta: Partial<GameStateType>) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function GameSetup(props: Props): JSX.Element {
  // TODO info button should show a help dialog
  return (
    <div id="menuCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Game Setup</Typography>
          <IconButton onClick={props.onBack} aria-label="info" edge="end" color="primary">
            <InfoIcon />
          </IconButton>
        </Toolbar>
      </div>
      <div id="centeredMenu">
        <FormControl>
          <InputLabel shrink>Difficulty</InputLabel>
          <Select
            id="difficulty"
            value={props.gameState.difficulty}
            onChange={(e: any) => props.onDelta({ difficulty: e.target.value })}
          >
            {Object.keys(DIFFICULTIES).map((d: DifficultyType) => {
              return <MenuItem value={d} key={d}>{d}</MenuItem>;
            })}
          </Select>
        </FormControl>
      </div>
      <div id="footer">
        <Button size="large" variant="contained" color="primary" onClick={props.onStart} autoFocus>Play</Button>
      </div>
    </div>
  );
}
