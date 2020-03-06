import {Button, IconButton, MenuItem, Select, Table, TableBody, TableCell, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowBackIosIcon from '@material-ui/icons/ArrowBackIos';
import InfoIcon from '@material-ui/icons/Info';
import * as React from 'react';

import {DIFFICULTIES, LOCATIONS} from 'app/Constants';
import {DialogType, DifficultyType, GameStateType, LocationType} from 'app/Types';

export interface StateProps {
  gameState: GameStateType;
}

export interface DispatchProps {
  onBack: () => void;
  onStart: () => void;
  onDelta: (delta: Partial<GameStateType>) => void;
  openDialog: (dialog: DialogType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function CustomGame(props: Props): JSX.Element {
  return (
    <div id="listCard">
      <div id="topbar">
        <Toolbar>
          <IconButton onClick={props.onBack} aria-label="back" edge="start" color="primary">
            <ArrowBackIosIcon />
          </IconButton>
          <Typography variant="h6">Custom Game Setup</Typography>
        </Toolbar>
      </div>
      <Table size="small" id="gameSetupTable">
        <TableBody>
          <TableRow>
            <TableCell>Location</TableCell>
            <TableCell>
              <Select
                id="location"
                value={props.gameState.location.id}
                onChange={(e: any) => {
                  const location = LOCATIONS.find((l) => l.id === e.target.value) || LOCATIONS[0];
                  props.onDelta({ location });
                }}
              >
                {LOCATIONS.map((l: LocationType) => {
                  return <MenuItem value={l.id} key={l.id}>{l.name}</MenuItem>;
                })}
              </Select>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Starting year</TableCell>
            <TableCell>
              <Select
                id="startingyear"
                value={props.gameState.startingYear}
                onChange={(e: any) => props.onDelta({ startingYear: e.target.value })}
              >
                <MenuItem value={1980}>1980</MenuItem>
                <MenuItem value={2000}>2000</MenuItem>
                <MenuItem value={2020}>2020</MenuItem>
              </Select>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Carbon Fee&nbsp;
              <IconButton onClick={() => props.openDialog({
                title: 'Carbon fee',
                message: 'A fee placed on pollution to cover its damage to society. Charged by the amount of greenhouse gas emitted, generally measured in "tons of CO2 equivalent".',
                open: true,
              })} color="primary"><InfoIcon /></IconButton>
            </TableCell>
            <TableCell>
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
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Difficulty</TableCell>
            <TableCell>
              <Select
                id="difficulty"
                value={props.gameState.difficulty}
                onChange={(e: any) => props.onDelta({ difficulty: e.target.value })}
              >
                {Object.keys(DIFFICULTIES).map((d: DifficultyType) => {
                  return <MenuItem value={d} key={d}>{d}</MenuItem>;
                })}
              </Select>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div style={{textAlign: 'center'}}>
        <Button size="large" variant="contained" color="primary" onClick={props.onStart} autoFocus>Play</Button>
      </div>
    </div>
  );
}
