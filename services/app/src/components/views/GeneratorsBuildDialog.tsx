import {Avatar, Button, Card, CardHeader, Collapse, Dialog, DialogContent, IconButton, Slider, Table, TableBody, TableCell, TableContainer, TableRow, Toolbar, Tooltip, Typography} from '@material-ui/core';
import {withStyles} from '@material-ui/core/styles';
import CloseIcon from '@material-ui/icons/Close';
import InfoIcon from '@material-ui/icons/Info';

import * as React from 'react';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {DOWNPAYMENT_PERCENT, GENERATORS} from '../../Constants';
import {GameStateType, GeneratorShoppingType} from '../../Types';

interface GeneratorBuildItemProps {
  cash: number;
  generator: GeneratorShoppingType;
  onBuild: (financed: boolean) => void;
}

function GeneratorBuildItem(props: GeneratorBuildItemProps): JSX.Element {
  const {generator, cash} = props;
  const [expanded, setExpanded] = React.useState(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.generator.buildCost;

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Card>
      <CardHeader
        avatar={<Avatar alt={generator.name} src={`/images/${generator.name.toLowerCase()}.png`} />}
        action={
          <span>
            <IconButton onClick={handleExpandClick} aria-label="show more">
              <InfoIcon color="primary" />
            </IconButton>
            <Button
              size="small"
              variant="contained"
              color={cash > generator.buildCost ? 'primary' : 'secondary'}
              onClick={(e: any) => props.onBuild(cash < generator.buildCost)}
              disabled={downpayment > cash}
            >
              {formatMoneyConcise(generator.buildCost)}
            </Button>
            <Typography variant="body2" color="textSecondary">
              {Math.round(generator.yearsToBuild * 12)} months
            </Typography>
          </span>
        }
        title={generator.name}
        subheader={generator.description}
      />
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="generator properties">
            <TableBody>
              <TableRow>
                <TableCell>Peak output
                  <Typography variant="body2" color="textSecondary">
                    In optimal conditions
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatWatts(generator.peakW)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Operating costs (/yr)
                  <Typography variant="body2" color="textSecondary">
                    Costs regardless of output
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(generator.annualOperatingCost)}</TableCell>
              </TableRow>
              {generator.spinMinutes && <TableRow>
                <TableCell>Spin up/down time
                  <Typography variant="body2" color="textSecondary">
                    To go from zero to full output
                  </Typography>
                </TableCell>
                <TableCell align="right">{generator.spinMinutes} min</TableCell>
              </TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>
    </Card>
  );
}

// Starting at 1MW, each tick increments the front number - when it overflows, instead add a 0
// (i.e. 1->2MW, 9->10 MW, 10->20MW)
function getW(tick: number) {
  const exponent = Math.floor(tick / 9) + 6;
  const frontNumber = tick % 9 + 1;
  return frontNumber * Math.pow(10, exponent);
}

function valueLabelFormat(x: number) {
  return formatWatts(getW(x));
}

interface ValueLabelProps {
  children: any;
  open: boolean;
  value: number;
}

const TooltipLarge = withStyles((theme) => ({
  tooltip: {
    fontSize: 14,
  },
}))(Tooltip);

function ValueLabelComponent(props: ValueLabelProps) {
  return (
    <TooltipLarge open={props.open} enterTouchDelay={0} placement="top" title={props.value} disableTouchListener arrow>
      {props.children}
    </TooltipLarge>
  );
}

export interface StateProps {
  gameState: GameStateType;
  cash: number;
  open: boolean;
  toggleOpen: () => void;
}

export interface DispatchProps {
  onBuildGenerator: (generator: GeneratorShoppingType, financed: boolean) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function GeneratorsBuildDialog(props: Props): JSX.Element {
  const {gameState, cash} = props;
  const [sliderTick, setSliderTick] = React.useState<number>(22);

  const handleSliderChange = (event: any, newValue: number) => {
    setSliderTick(newValue);
  };

  return (
    <Dialog
      fullScreen
      open={props.open}
      onClose={props.toggleOpen}
    >
      <Toolbar>
        <Typography variant="h6">Build a Generator ({formatMoneyStable(cash)})</Typography>
        <IconButton edge="end" color="primary" onClick={props.toggleOpen} aria-label="close">
          <CloseIcon />
        </IconButton>
        <Typography id="peak-output" className="flex-newline" variant="body2" color="textSecondary">
          Generator capacity
        </Typography>
        <Slider
          className="flex-newline"
          value={sliderTick}
          aria-labelledby="peak-output"
          valueLabelDisplay="on"
          min={0}
          step={1}
          max={36}
          getAriaValueText={valueLabelFormat}
          valueLabelFormat={valueLabelFormat}
          ValueLabelComponent={ValueLabelComponent}
          onChange={handleSliderChange}
        />
      </Toolbar>
      <DialogContent classes={{root: 'generatorBuildList'}}>
        {GENERATORS(gameState, getW(sliderTick)).map((g: GeneratorShoppingType, i: number) =>
          <GeneratorBuildItem
            generator={g}
            key={i}
            cash={cash}
            onBuild={(financed: boolean) => { props.onBuildGenerator(g, financed); props.toggleOpen(); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
