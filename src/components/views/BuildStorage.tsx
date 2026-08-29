import * as React from "react";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  Menu,
  MenuItem,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Toolbar,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import CloseIcon from "@mui/icons-material/Close";
import PauseIcon from "@mui/icons-material/Pause";
import SortIcon from "@mui/icons-material/Sort";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { getMonthlyPayment } from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatMoneyStable,
  formatWatts,
} from "../../helpers/Format";
import { DOWNPAYMENT_PERCENT, LOAN_MONTHS } from "../../Constants";
import { STORAGE } from "../../data/Facilities";
import { MANUAL_ENTRY } from "../../data/Manual";
import ManualLink from "../base/ManualLink";
import ConceptIcon from "../base/ConceptIcon";
import {
  getBuildAvailability,
  ViableLocationsRow,
} from "../base/BuildAvailability";
import { GameType, SpeedType, StorageShoppingType } from "../../Types";

interface StorageBuildItemProps {
  cash: number;
  interestRate: number;
  storage: StorageShoppingType;
  onBuild: (financed: boolean) => void;
}

function StorageBuildItem(props: StorageBuildItemProps): React.JSX.Element {
  const { storage, cash } = props;
  const [expanded, setExpanded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const downpayment = DOWNPAYMENT_PERCENT * props.storage.buildCost;
  const loanAmount = props.storage.buildCost - downpayment;
  const monthlyPayment = getMonthlyPayment(
    loanAmount,
    props.interestRate,
    LOAN_MONTHS,
  );
  const sizeBuildable = props.storage.peakWh <= props.storage.maxPeakWh;
  const { buildable, secondaryText } = getBuildAvailability(
    storage.description,
    sizeBuildable,
    `${formatWatts(storage.maxPeakWh)}h`,
    storage.viableLocationsRemaining,
  );

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: React.SyntheticEvent) => {
    setOpen(!open);
    e.stopPropagation();
  };

  // const monthlyInterest = getPaymentInterest(loanAmount, props.interestRate);
  // <TableRow>
  // <TableCell>Payments during construction (interest only)</TableCell>
  // <TableCell align="right">{formatMoneyConcise(monthlyInterest)}/mo</TableCell>
  // </TableRow>

  return (
    <Card className="build-list-item">
      <CardHeader
        avatar={
          <Avatar
            alt={storage.name}
            src={`/images/${storage.name.toLowerCase()}.svg`}
          />
        }
        action={
          <span>
            <Button
              size="small"
              variant="contained"
              color="primary"
              onClick={toggleOpen}
              disabled={downpayment > cash || !buildable}
              startIcon={<ConceptIcon concept="buy" fontSize="small" />}
            >
              {formatMoneyConcise(storage.buildCost)}
            </Button>
            <Typography variant="body2" color="textSecondary">
              {Math.round(storage.yearsToBuild * 12)}mo to build
              <br />
              {formatWatts(storage.peakW)}
            </Typography>
          </span>
        }
        title={storage.name}
        subheader={secondaryText}
      />
      <Button
        color="primary"
        className="expand-details"
        size="small"
        aria-label={`${expanded ? "Hide" : "Show"} ${storage.name} details`}
        aria-expanded={expanded}
        endIcon={expanded ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />}
        onClick={toggleExpand}
      >
        {expanded ? "Hide details" : "Show details"}
      </Button>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableContainer>
          <Table size="small" aria-label="storage properties">
            <TableBody>
              <TableRow>
                <TableCell>
                  Peak output
                  <Typography variant="body2" color="textSecondary">
                    Increases with capacity
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatWatts(storage.peakW)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Operating costs (/yr)
                  <Typography variant="body2" color="textSecondary">
                    Costs regardless of output
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {formatMoneyConcise(storage.annualOperatingCost)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  Ramp up/down time
                  <ManualLink
                    entry={MANUAL_ENTRY.RAMP_RATE}
                    label="ramp rate"
                  />
                  <Typography variant="body2" color="textSecondary">
                    To go from zero to full output
                  </Typography>
                </TableCell>
                <TableCell align="right">{storage.spinMinutes} min</TableCell>
              </TableRow>
              <ViableLocationsRow
                remaining={storage.viableLocationsRemaining}
              />
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      <Dialog open={open} onClose={toggleOpen}>
        <DialogTitle>
          Build {formatWatts(storage.peakWh)}h {storage.name}?
          <IconButton
            aria-label="close"
            onClick={toggleOpen}
            className="top-right"
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent className="noPadding">
          <TableContainer>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Time to build</TableCell>
                  <TableCell align="right">
                    {Math.round(storage.yearsToBuild * 12)} mo
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Cash cost</TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(storage.buildCost)}
                  </TableCell>
                </TableRow>
                <TableRow className="bold">
                  <TableCell colSpan={2}>Loan info</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Downpayment</TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(downpayment)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    Interest rate
                    <ManualLink
                      entry={MANUAL_ENTRY.INTEREST_RATES}
                      label="interest rate"
                    />
                  </TableCell>
                  <TableCell align="right">
                    {(props.interestRate * 100).toFixed(2)}%
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Monthly payments</TableCell>
                  <TableCell align="right">
                    {formatMoneyConcise(monthlyPayment)}/mo
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Loan duration</TableCell>
                  <TableCell align="right">
                    Construction + {LOAN_MONTHS / 12} years
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button
            color="primary"
            disabled={cash < storage.buildCost}
            variant="contained"
            onClick={(e: React.MouseEvent<HTMLElement>) => {
              props.onBuild(false);
              toggleOpen(e);
            }}
            startIcon={<ConceptIcon concept="money" fontSize="small" />}
          >
            Pay cash
          </Button>
          <Button
            color="primary"
            variant="contained"
            onClick={(e: React.MouseEvent<HTMLElement>) => {
              props.onBuild(true);
              toggleOpen(e);
            }}
            startIcon={<ConceptIcon concept="finances" fontSize="small" />}
          >
            Take loan
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

const sortOptions = [
  ["buildCost", "Build Cost"],
  ["yearsToBuild", "Build Time"],
];

// Starting at 1MW, each tick increments the front number - when it overflows, instead add a 0 (i.e. 1->2MW, 9->10 MW, 10->20MW)
function getW(tick: number) {
  const exponent = Math.floor(tick / 9) + 6;
  const frontNumber = (tick % 9) + 1;
  return frontNumber * Math.pow(10, exponent);
}

function getTickFromW(w: number) {
  const exponent = Math.floor(Math.log10(w)) - 6;
  const frontNumber = +w.toString().charAt(0);
  return frontNumber + exponent * 9 - 1;
}

function valueLabelFormat(x: number) {
  return formatWatts(getW(x));
}

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onBuildStorage: (storage: StorageShoppingType, financed: boolean) => void;
  onBack: () => void;
  onSpeedChange: (speed: SpeedType) => void;
}

export interface Props extends StateProps, DispatchProps {}

export default function StorageBuildDialog(props: Props): React.JSX.Element {
  const { game, onBack } = props;
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const filtered = game.facilities.filter((f) => f.peakWh);
  const mostRecentId = filtered.reduce((id, f) => (id < f.id ? f.id : id), -1);
  const mostRecentBuiltValue =
    (filtered.find((f) => f.id === mostRecentId) || {}).peakWh || 500000000;
  const [sliderTick, setSliderTick] = React.useState<number>(
    getTickFromW(mostRecentBuiltValue),
  );
  const [sort, setSort] = React.useState<string>("buildCost");
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  if (!now) {
    return <span />;
  }

  const cash = now.cash;
  const storage = STORAGE(game, getW(sliderTick)).sort((a, b) =>
    a[sort] > b[sort] ? 1 : -1,
  );

  const handleSliderChange = (_event: Event, newValue: number | number[]) => {
    if (Array.isArray(newValue)) {
      newValue = newValue[0];
    }
    setSliderTick(newValue);
  };

  const onSort = (newValue: string) => {
    setSort(newValue);
    onSortClose();
  };

  const onSortOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const onSortClose = () => {
    setAnchorEl(null);
  };

  return (
    <div id="topbar" className="flexContainer">
      <Toolbar className="bottomBorder">
        <Typography variant="h6">
          {formatMoneyStable(cash)}{" "}
          <span className="weak gameStatusValue">
            <ConceptIcon concept="storage" fontSize="small" />
            Build Storage
          </span>
        </Typography>
        {game.speed !== "PAUSED" && (
          <IconButton
            onClick={() => props.onSpeedChange("PAUSED")}
            aria-label="pause"
            edge="end"
            color="primary"
            size="large"
          >
            <PauseIcon />
          </IconButton>
        )}
        <IconButton
          id="close-button"
          edge="end"
          color="primary"
          onClick={onBack}
          aria-label="close"
          size="large"
        >
          <CloseIcon />
        </IconButton>
        <div className="flex-newline"></div>
        <div
          id="yearProgressBar"
          style={{
            width: `${game.date.percentOfYear * 100}%`,
          }}
        />
        <Typography
          id="peak-output"
          className="flex-newline"
          variant="body2"
          color="textSecondary"
        >
          Capacity:{" "}
          <Typography color="primary" component="strong">
            {valueLabelFormat(sliderTick)}h
          </Typography>{" "}
          {filtered.length <= 0 && "(slide to change)"}
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
        <IconButton
          edge="end"
          color="primary"
          onClick={onSortOpen}
          aria-label="sort"
          size="large"
        >
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
            return (
              <MenuItem onClick={() => onSort(option[0])} key={option[0]}>
                {sort === option[0] ? (
                  <strong>{option[1]}</strong>
                ) : (
                  <span className="weak">{option[1]}</span>
                )}
              </MenuItem>
            );
          })}
        </Menu>
      </Toolbar>
      <List dense className="scrollable cardList">
        {storage.map((g: StorageShoppingType, i: number) => (
          <StorageBuildItem
            storage={g}
            key={i}
            cash={cash}
            interestRate={game.interestRate}
            onBuild={(financed: boolean) => {
              props.onBuildStorage(g, financed);
              onBack();
            }}
          />
        ))}
      </List>
    </div>
  );
}
