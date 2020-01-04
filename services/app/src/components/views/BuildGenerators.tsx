import {Avatar, Button, Card, CardHeader, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, Slider, Table, TableBody, TableCell, TableContainer, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import ArrowDropUpIcon from '@material-ui/icons/ArrowDropUp';
import CloseIcon from '@material-ui/icons/Close';

import * as React from 'react';
import {getMonthlyPayment, getPaymentInterest, LCOE} from 'shared/helpers/Financials';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {DOWNPAYMENT_PERCENT, FUELS, GENERATORS, INTEREST_RATE_YEARLY, LOAN_MONTHS} from '../../Constants';
import {GameStateType, GeneratorShoppingType} from '../../Types';

interface GeneratorBuildItemProps {
  cash: number;
  generator: GeneratorShoppingType;
  onBuild: (financed: boolean) => void;
}

function GeneratorBuildItem(props: GeneratorBuildItemProps): JSX.Element {
  const {generator, cash} = props;
  const fuel = FUELS[generator.fuel] || {};
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.generator.buildCost;
  const loanAmount = props.generator.buildCost - downpayment;
  const monthlyPayment = getMonthlyPayment(loanAmount, INTEREST_RATE_YEARLY, LOAN_MONTHS);
  const monthlyInterest = getPaymentInterest(loanAmount, INTEREST_RATE_YEARLY, monthlyPayment);

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: any) => {
    setOpen(!open);
    e.stopPropagation();
  };

  return (
    <Card onClick={toggleExpand}>
      <CardHeader
        avatar={<Avatar alt={generator.name} src={`/images/${generator.name.toLowerCase()}.png`} />}
        action={
          <span>
            <Button
              size="small"
              variant="contained"
              color={cash > generator.buildCost ? 'primary' : 'secondary'}
              onClick={(e: any) => {
                if (cash < generator.buildCost) { toggleOpen(e); } else { props.onBuild(false); }
                e.stopPropagation();
              }}
              disabled={downpayment > cash}
            >
              {formatMoneyConcise(generator.buildCost)}
            </Button>
            <Typography variant="body2" color="textSecondary">
              {Math.round(generator.yearsToBuild * 12)}m to build
            </Typography>
          </span>
        }
        title={generator.name}
        subheader={generator.description}
      />
      {!expanded && <ArrowDropDownIcon color="primary" className="expand-icon"  />}
      {expanded && <ArrowDropUpIcon color="primary" className="expand-icon"  />}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="generator properties">
            <TableBody>
              <TableRow>
                <TableCell>Total energy cost
                  <Typography variant="body2" color="textSecondary">
                    Across lifespan
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(LCOE(generator) * 1000000)}/MWh</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Average output
                  <Typography variant="body2" color="textSecondary">
                    Across a year
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatWatts(generator.peakW * generator.capacityFactor)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Operating costs
                  <Typography variant="body2" color="textSecondary">
                    Regardless of output
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(generator.annualOperatingCost)}/yr</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Fuel costs
                  <Typography variant="body2" color="textSecondary">
                    Varies with fuel prices
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(1000000 * generator.btuPerWh * fuel.costPerBtu || 0)}/MWh</TableCell>
              </TableRow>
              {generator.spinMinutes > 1 && <TableRow>
                <TableCell>Spin up/down time
                  <Typography variant="body2" color="textSecondary">
                    To go from zero to full output
                  </Typography>
                </TableCell>
                <TableCell align="right">{generator.spinMinutes} min</TableCell>
              </TableRow>}
              <TableRow>
                <TableCell>Expected lifespan</TableCell>
                <TableCell align="right">{generator.lifespanYears} years</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      <Dialog
        open={open}
        onClose={toggleOpen}
      >
        <DialogTitle>Take a loan to build {generator.name}?</DialogTitle>
        <DialogContent dividers>
          <TableContainer>
            <Table size="small" aria-label="loan properties">
              <TableBody>
                <TableRow>
                  <TableCell>Loan amount</TableCell>
                  <TableCell align="right">{formatMoneyConcise(loanAmount)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Downpayment</TableCell>
                  <TableCell align="right">{formatMoneyConcise(downpayment)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Interest rate (/yr)</TableCell>
                  <TableCell align="right">{(INTEREST_RATE_YEARLY * 100).toFixed(1)}%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Payments during construction (interest only)</TableCell>
                  <TableCell align="right">{formatMoneyConcise(monthlyInterest)}/mo</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Payments once complete (principle + interest)</TableCell>
                  <TableCell align="right">{formatMoneyConcise(monthlyPayment)}/mo</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Loan duration</TableCell>
                  <TableCell align="right">Construction + {LOAN_MONTHS / 12} years</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button autoFocus color="primary" onClick={toggleOpen}>
            Cancel
          </Button>
          <Button color="primary" variant="contained" onClick={(e: any) => { props.onBuild(true); toggleOpen(e); }}>
            Built it
          </Button>
        </DialogActions>
      </Dialog>
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

export interface StateProps {
  gameState: GameStateType;
  cash: number;
}

export interface DispatchProps {
  onBuildGenerator: (generator: GeneratorShoppingType, financed: boolean) => void;
  onBack: () => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function BuildGenerators(props: Props): JSX.Element {
  const {gameState, cash, onBack} = props;
  const [sliderTick, setSliderTick] = React.useState<number>(22);

  const handleSliderChange = (event: any, newValue: number) => {
    setSliderTick(newValue);
  };

  // TODO use the main card template

  return (
    <div className="flexContainer">
      <Toolbar>
        <Typography variant="h6"><span className="weak">Build a Generator</span> ({formatMoneyStable(cash)})</Typography>
        <IconButton edge="end" color="primary" onClick={onBack} aria-label="close">
          <CloseIcon />
        </IconButton>
        <Typography id="peak-output" className="flex-newline" variant="body2" color="textSecondary">
          Generator capacity: <Typography color="primary" component="strong">{valueLabelFormat(sliderTick)}</Typography>
        </Typography>
        <Slider
          className="flex-newline"
          value={sliderTick}
          aria-labelledby="peak-output"
          valueLabelDisplay="off"
          min={0}
          step={1}
          max={36}
          onChange={handleSliderChange}
        />
      </Toolbar>
      <List dense className="scrollable buildList">
        {GENERATORS(gameState, getW(sliderTick)).map((g: GeneratorShoppingType, i: number) =>
          <GeneratorBuildItem
            generator={g}
            key={i}
            cash={cash}
            onBuild={(financed: boolean) => { props.onBuildGenerator(g, financed); onBack(); }}
          />
        )}
      </List>
    </div>
  );
}
