import {Avatar, Button, Card, CardHeader, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, Menu, MenuItem, Slider, Table, TableBody, TableCell, TableContainer, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import ArrowDropUpIcon from '@material-ui/icons/ArrowDropUp';
import CloseIcon from '@material-ui/icons/Close';
import PauseIcon from '@material-ui/icons/Pause';
import SortIcon from '@material-ui/icons/Sort';

import * as React from 'react';
import {getMonthlyPayment, getPaymentInterest } from 'shared/helpers/Financials';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {getFuelPrices} from 'shared/schema/FuelPrices';
import {DOWNPAYMENT_PERCENT, FUELS, GENERATORS, INTEREST_RATE_YEARLY, LOAN_MONTHS} from '../../Constants';
import {DateType, GameStateType, GeneratorShoppingType, SpeedType} from '../../Types';

interface GeneratorBuildItemProps {
  cash: number;
  date: DateType;
  generator: GeneratorShoppingType;
  secondaryMetric?: string;
  onBuild: (financed: boolean) => void;
}

function GeneratorBuildItem(props: GeneratorBuildItemProps): JSX.Element {
  const {generator, cash} = props;
  const fuel = FUELS[generator.fuel] || {};
  const fuelPrices = getFuelPrices(props.date);
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.generator.buildCost;
  const loanAmount = props.generator.buildCost - downpayment;
  const monthlyPayment = getMonthlyPayment(loanAmount, INTEREST_RATE_YEARLY, LOAN_MONTHS);
  const monthlyInterest = getPaymentInterest(loanAmount, INTEREST_RATE_YEARLY, monthlyPayment);
  const buildable = props.generator.peakW <= props.generator.maxPeakW;
  const secondaryText = (buildable) ? `~${formatMoneyConcise(generator.lcWh * 1000000)}/MWh. ${generator.description}` : `Too large for current tech; max size ${formatWatts(props.generator.maxPeakW)}`;

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: any) => {
    setOpen(!open);
    e.stopPropagation();
  };

  return (
    <Card onClick={toggleExpand} className="build-list-item expandable">
      <CardHeader
        avatar={<Avatar alt={generator.name} src={`/images/${generator.name.toLowerCase()}.svg`} />}
        action={
          <span>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={(e: any) => {
                if (cash < generator.buildCost) { toggleOpen(e); } else { props.onBuild(false); }
                e.stopPropagation();
              }}
              disabled={downpayment > cash || !buildable}
            >
              {formatMoneyConcise(generator.buildCost)}
            </Button>
            <Typography variant="body2" color="textSecondary">{`${Math.round(generator.yearsToBuild * 12)}m to build`}</Typography>
          </span>
        }
        title={generator.name}
        subheader={secondaryText}
      />
      {!expanded && <ArrowDropDownIcon color="primary" className="expand-icon"  />}
      {expanded && <ArrowDropUpIcon color="primary" className="expand-icon"  />}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="generator properties">
            <TableBody>
              {props.secondaryMetric !== 'lcWh' && <TableRow>
                <TableCell>Total energy cost
                  <Typography variant="body2" color="textSecondary">
                    Across life, based on {Math.round(generator.capacityFactor * 100)}% uptime
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(generator.lcWh * 1000000)}/MWh</TableCell>
              </TableRow>}
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
              {fuelPrices[generator.fuel] && <TableRow>
                <TableCell>Fuel costs
                  <Typography variant="body2" color="textSecondary">
                    Varies with fuel prices
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(1000000 * generator.btuPerWh * fuelPrices[generator.fuel] || 0)}/MWh</TableCell>
              </TableRow>}
              {generator.spinMinutes > 1 && <TableRow>
                <TableCell>Ramp up/down time
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
              {props.secondaryMetric !== 'yearsToBuild' && <TableRow>
                <TableCell>Time to build</TableCell>
                <TableCell align="right">{Math.round(generator.yearsToBuild * 12)} mo</TableCell>
              </TableRow>}
              {fuel.kgCO2ePerBtu > 0 && <TableRow>
                <TableCell>Air pollution
                  <Typography variant="body2" color="textSecondary">
                    (kg of CO2 equivalent)
                  </Typography>
                </TableCell>
                <TableCell align="right">{Math.round(1000000 * generator.btuPerWh * fuel.kgCO2ePerBtu || 0)}kg/MWh</TableCell>
              </TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      <Dialog
        open={open}
        onClose={toggleOpen}
      >
        <DialogTitle>Take a loan to build {generator.name}?</DialogTitle>
        <DialogContent dividers className="noPadding">
          <TableContainer>
            <Table size="small" aria-label="loan properties">
              <TableBody>
                <TableRow>
                  <TableCell>Downpayment</TableCell>
                  <TableCell align="right">{formatMoneyConcise(downpayment)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Interest rate</TableCell>
                  <TableCell align="right">{(INTEREST_RATE_YEARLY * 100).toFixed(1)}%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Payments during construction (interest only)</TableCell>
                  <TableCell align="right">{formatMoneyConcise(monthlyInterest)}/mo</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Payments once built (principle + interest)</TableCell>
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

const sortOptions = [
  ['buildCost', 'Build Cost'],
  ['yearsToBuild', 'Build Time'],
  ['lcWh', 'Cost per MWh'],
];

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
  onSpeedChange: (speed: SpeedType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function BuildGenerators(props: Props): JSX.Element {
  const {gameState, cash, onBack} = props;
  const [sliderTick, setSliderTick] = React.useState<number>(22);
  const [sort, setSort] = React.useState<string>('buildCost');
  const [anchorEl, setAnchorEl] = React.useState(null);
  const generators = GENERATORS(gameState, getW(sliderTick)).sort((a, b) => a[sort] > b[sort] ? 1 : -1);

  const onSlider = (event: any, newValue: number) => {
    setSliderTick(newValue);
  };

  const onSort = (newValue: string) => {
    setSort(newValue);
    onSortClose();
  };

  const onSortOpen = (event: any) => {
    setAnchorEl(event.currentTarget);
  };

  const onSortClose = () => {
    setAnchorEl(null);
  };

  return (
    <div id="topbar" className="flexContainer">
      <Toolbar>
        <Typography variant="h6"><span className="weak">Build a Generator</span> ({formatMoneyStable(cash)})</Typography>
        {gameState.speed !== 'PAUSED' && <IconButton onClick={() => props.onSpeedChange('PAUSED') } aria-label="pause">
          <PauseIcon color="primary" />
        </IconButton>}
        <IconButton edge="end" color="primary" onClick={onBack} aria-label="close">
          <CloseIcon />
        </IconButton>
        <div className="flex-newline"></div>
        <div id="yearProgressBar" style={{
          width: `${gameState.date.percentOfYear * 100}%`,
        }}/>
        <Typography id="peak-output" className="flex-newline" variant="body2" color="textSecondary">
          Generator capacity: <Typography color="primary" component="strong">{valueLabelFormat(sliderTick)}</Typography>
        </Typography>
        <Slider
          value={sliderTick}
          aria-labelledby="peak-output"
          valueLabelDisplay="off"
          min={0}
          step={1}
          max={34}
          onChange={onSlider}
        />
        <IconButton edge="end" color="primary" onClick={onSortOpen} aria-label="sort">
          <SortIcon />
        </IconButton>
        <Menu
          id="sort-menu"
          anchorEl={anchorEl}
          keepMounted
          open={Boolean(anchorEl)}
          onClose={onSortClose}
        >
          {sortOptions.map((option) => {
            return <MenuItem onClick={() => onSort(option[0])} key={option[0]}>
              {sort === option[0] ? <strong>{option[1]}</strong> : <span className="weak">{option[1]}</span>}
            </MenuItem>;
          })}
        </Menu>
      </Toolbar>
      <List dense className="scrollable expandableList">
        {generators.map((g: GeneratorShoppingType, i: number) =>
          <GeneratorBuildItem
            date={gameState.date}
            generator={g}
            key={i}
            cash={cash}
            secondaryMetric={(sort === 'buildCost') ? 'yearsToBuild' : sort}
            onBuild={(financed: boolean) => { props.onBuildGenerator(g, financed); onBack(); }}
          />
        )}
      </List>
    </div>
  );
}
