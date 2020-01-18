import {Button, Checkbox, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Select, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import InfoIcon from '@material-ui/icons/Info';
import * as React from 'react';

import {DIFFICULTIES} from 'app/Constants';
import {DifficultyType, GameStateType} from 'app/Types';

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
  // or, instead, each item should have its own info / help button
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
          <InputLabel>Difficulty</InputLabel>
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
        <br/>
        <FormControl>
          <InputLabel>Carbon Fee</InputLabel>
          <Select
            id="carbonfee"
            value={props.gameState.feePerKgCO2e}
            onChange={(e: any) => props.onDelta({ feePerKgCO2e: e.target.value })}
          >
            <MenuItem value={0}>$0/ton</MenuItem>
            <MenuItem value={20 / 1000}>$20/ton</MenuItem>
            <MenuItem value={50 / 1000}>$50/ton</MenuItem>
            <MenuItem value={100 / 1000}>$100/ton</MenuItem>
          </Select>
        </FormControl>
        <br/>
        <FormControlLabel
          control={
            <Checkbox
              checked={props.gameState.inTutorial}
              onChange={(e: any) => props.onDelta({ inTutorial: !props.gameState.inTutorial })}
              color="primary"
            />
          }
          label="Show tutorial prompts"
        />
      </div>
      <div id="footer">
        <Button size="large" variant="contained" color="primary" onClick={props.onStart} autoFocus>Play</Button>
      </div>
    </div>
  );
}
