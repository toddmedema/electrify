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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import CloseIcon from "@mui/icons-material/Close";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { getMonthlyPayment } from "../../helpers/Financials";
import {
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
} from "../../helpers/Format";
import { DOWNPAYMENT_PERCENT, LOAN_MONTHS } from "../../Constants";
import { STORAGE } from "../../data/Facilities";
import { MANUAL_ENTRY } from "../../data/Manual";
import ManualLink from "../base/ManualLink";
import ConceptIcon from "../base/ConceptIcon";
import DecisionImpactPreview from "../base/DecisionImpactPreview";
import {
  getBuildAvailability,
  ViableLocationsRow,
} from "../base/BuildAvailability";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import { GameType, StorageShoppingType } from "../../Types";

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
  const [financingExpanded, setFinancingExpanded] = React.useState(false);
  const financingTermsId = React.useId();
  const purchaseSubmitted = React.useRef(false);
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
    storage.available,
    sizeBuildable,
    `${formatWatts(storage.maxPeakWh)}h`,
    storage.viableLocationsRemaining,
  );
  const financingGap = Math.max(0, downpayment - cash);
  const buildSubtitle =
    buildable && financingGap > 0
      ? `Can't afford the loan down payment. Need ${formatMoneyConcise(financingGap)} more cash.`
      : secondaryText;

  const toggleExpand = () => {
    setExpanded(!expanded);
  };

  const toggleOpen = (e: React.SyntheticEvent) => {
    if (!open) {
      purchaseSubmitted.current = false;
      setFinancingExpanded(false);
    }
    setOpen(!open);
    e.stopPropagation();
  };

  const submitPurchase = (
    financed: boolean,
    e: React.MouseEvent<HTMLElement>,
  ) => {
    if (purchaseSubmitted.current) {
      return;
    }
    purchaseSubmitted.current = true;
    props.onBuild(financed);
    toggleOpen(e);
  };

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
        subheader={buildSubtitle}
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
          <DecisionImpactPreview
            facts={[
              {
                concept: "money",
                label: "Cash purchase",
                value: `${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - storage.buildCost)}`,
              },
              {
                concept: "time",
                label: "Online in",
                value: `${Math.round(storage.yearsToBuild * 12)} months`,
                detail:
                  "Stored energy and discharge power do not increase until construction finishes.",
              },
              {
                concept: "storage",
                label: "Energy capacity",
                value: `+${formatWattHours(storage.peakWh)} stored energy`,
                detail: `${formatWatts(storage.peakW)} maximum charge or discharge rate`,
              },
              {
                concept: "supply",
                label: "Round-trip efficiency",
                value: `${Math.round(storage.roundTripEfficiency * 100)}%`,
              },
            ]}
          />
          <Button
            color="primary"
            size="small"
            fullWidth
            aria-expanded={financingExpanded}
            aria-controls={financingTermsId}
            endIcon={
              financingExpanded ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />
            }
            onClick={() => setFinancingExpanded((value) => !value)}
          >
            {financingExpanded
              ? "Hide financing terms"
              : "Show financing terms"}
          </Button>
          <Collapse in={financingExpanded} timeout="auto" unmountOnExit>
            <TableContainer id={financingTermsId}>
              <Table size="small" aria-label="Financing terms">
                <TableBody>
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
          </Collapse>
        </DialogContent>
        <DialogActions>
          <Button
            color="primary"
            disabled={cash < storage.buildCost}
            variant="contained"
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              submitPurchase(false, e)
            }
            startIcon={<ConceptIcon concept="money" fontSize="small" />}
          >
            Pay cash
          </Button>
          <Button
            color="primary"
            variant="contained"
            onClick={(e: React.MouseEvent<HTMLElement>) =>
              submitPurchase(true, e)
            }
            startIcon={<ConceptIcon concept="finances" fontSize="small" />}
          >
            Take loan
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

type StorageSortKey = "buildCost" | "yearsToBuild";

const sortOptions: ReadonlyArray<readonly [StorageSortKey, string]> = [
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
  const [sort, setSort] = React.useState<StorageSortKey>("buildCost");

  if (!now) {
    return <span />;
  }

  const cash = now.cash;
  const storage = STORAGE(game, getW(sliderTick)).sort(
    (a, b) => a[sort] - b[sort],
  );

  return (
    <div id="topbar" className="flexContainer">
      <ConstructionBuildHeader
        concept="storage"
        title="Build Storage"
        cash={cash}
        capacity={`${valueLabelFormat(sliderTick)}h`}
        sliderValue={sliderTick}
        sliderMin={4}
        sliderMax={37}
        sort={sort}
        sortOptions={sortOptions}
        onClose={onBack}
        onSliderChange={setSliderTick}
        onSortChange={(value) => setSort(value as StorageSortKey)}
      />
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
