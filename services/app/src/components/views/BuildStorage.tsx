import {Avatar, Button, Card, CardHeader, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, Menu, MenuItem, Slider, Table, TableBody, TableCell, TableContainer, TableRow, Toolbar, Typography} from '@material-ui/core';
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown';
import ArrowDropUpIcon from '@material-ui/icons/ArrowDropUp';
import CloseIcon from '@material-ui/icons/Close';
import PauseIcon from '@material-ui/icons/Pause';
import SortIcon from '@material-ui/icons/Sort';

import * as React from 'react';
import {getMonthlyPayment, getPaymentInterest} from 'shared/helpers/Financials';
import {formatMoneyConcise, formatMoneyStable, formatWatts} from 'shared/helpers/Format';
import {DOWNPAYMENT_PERCENT, INTEREST_RATE_YEARLY, LOAN_MONTHS, STORAGE} from '../../Constants';
import {GameStateType, SpeedType, StorageShoppingType} from '../../Types';

interface StorageBuildItemProps {
  cash: number;
  storage: StorageShoppingType;
  onBuild: (financed: boolean) => void;
}

function StorageBuildItem(props: StorageBuildItemProps): JSX.Element {
  const {storage, cash} = props;
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.storage.buildCost;
  const loanAmount = props.storage.buildCost - downpayment;
  const monthlyPayment = getMonthlyPayment(loanAmount, INTEREST_RATE_YEARLY, LOAN_MONTHS);
  const monthlyInterest = getPaymentInterest(loanAmount, INTEREST_RATE_YEARLY, monthlyPayment);
  const buildable = props.storage.peakWh <= props.storage.maxPeakWh;
  const secondaryText = (buildable) ? storage.description : `Too large for current tech; max size ${formatWatts(props.storage.maxPeakWh)}h`;

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: any) => {
    setOpen(!open);
    e.stopPropagation();
  };

  return (
    <Card onClick={toggleExpand} className="build-list-item">
      <CardHeader
        avatar={<Avatar alt={storage.name} src={`/images/${storage.name.toLowerCase()}.svg`} />}
        action={
          <span>
            <Button
              size="small"
              variant="contained"
              color={cash > storage.buildCost ? 'primary' : 'secondary'}
              onClick={(e: any) => {
                if (cash < storage.buildCost) { toggleOpen(e); } else { props.onBuild(false); }
                e.stopPropagation();
              }}
              disabled={downpayment > cash || !buildable}
            >
              {formatMoneyConcise(storage.buildCost)}
            </Button>
            <Typography variant="body2" color="textSecondary">
              {Math.round(storage.yearsToBuild * 12)}m to build
            </Typography>
          </span>
        }
        title={storage.name}
        subheader={secondaryText}
      />
      {!expanded && <ArrowDropDownIcon color="primary" className="expand-icon"  />}
      {expanded && <ArrowDropUpIcon color="primary" className="expand-icon"  />}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="storage properties">
            <TableBody>
              <TableRow>
                <TableCell>Peak output</TableCell>
                <TableCell align="right">{formatWatts(storage.peakW)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Operating costs (/yr)
                  <Typography variant="body2" color="textSecondary">
                    Costs regardless of output
                  </Typography>
                </TableCell>
                <TableCell align="right">{formatMoneyConcise(storage.annualOperatingCost)}</TableCell>
              </TableRow>
              {storage.spinMinutes > 1 && <TableRow>
                <TableCell>Spin up/down time
                  <Typography variant="body2" color="textSecondary">
                    To go from zero to full output
                  </Typography>
                </TableCell>
                <TableCell align="right">{storage.spinMinutes} min</TableCell>
              </TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      <Dialog
        open={open}
        onClose={toggleOpen}
      >
        <DialogTitle>Take a loan to build {storage.name}?</DialogTitle>
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

const sortOptions = [
  ['buildCost', 'Build Cost'],
  ['yearsToBuild', 'Build Time'],
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
  onBuildStorage: (storage: StorageShoppingType, financed: boolean) => void;
  onBack: () => void;
  onSpeedChange: (speed: SpeedType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function StorageBuildDialog(props: Props): JSX.Element {
  const {gameState, cash, onBack} = props;
  const [sliderTick, setSliderTick] = React.useState<number>(22);
  const [sort, setSort] = React.useState<string>('buildCost');
  const [anchorEl, setAnchorEl] = React.useState(null);
  const storage = STORAGE(gameState, getW(sliderTick)).sort((a, b) => a[sort] > b[sort] ? 1 : -1);

  const handleSliderChange = (event: any, newValue: number) => {
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
        <Typography variant="h6"><span className="weak">Build Storage</span> ({formatMoneyStable(cash)})</Typography>
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
          Storage capacity: <Typography color="primary" component="strong">{valueLabelFormat(sliderTick)}h</Typography>
        </Typography>
        <Slider
          value={sliderTick}
          aria-labelledby="peak-output"
          valueLabelDisplay="off"
          min={4}
          step={1}
          max={37}
          onChange={handleSliderChange}
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
      <List dense className="scrollable buildList">
        {storage.map((g: StorageShoppingType, i: number) =>
          <StorageBuildItem
            storage={g}
            key={i}
            cash={cash}
            onBuild={(financed: boolean) => { props.onBuildStorage(g, financed); onBack(); }}
          />
        )}
      </List>
    </div>
  );
}
