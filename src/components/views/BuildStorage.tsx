import * as React from "react";
import {
  Button,
  List,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from "@mui/material";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { purchaseTerms } from "../../helpers/Financials";
import {
  floorToTwoSignificantDigits,
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
} from "../../helpers/Format";
import { STORAGE } from "../../data/Facilities";
import { MANUAL_ENTRY } from "../base/ManualEntries";
import ManualLink from "../base/ManualLink";
import BuildOptionCard from "../base/BuildOptionCard";
import {
  mostRecentBuiltSize,
  sliderTickToW,
  wToSliderTick,
} from "../../helpers/BuildSizing";
import PurchaseReviewDialog, {
  financingShortfallText,
} from "../base/PurchaseReviewDialog";
import {
  getBuildAvailability,
  getSiteInventory,
  siteCountLabel,
  ViableLocationsRow,
} from "../base/BuildAvailability";
import BuildMetric from "../base/BuildMetric";
import {
  formatLargeMassValueConcise,
  largeMassUnit,
} from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import { GameType, LocationType, StorageShoppingType } from "../../Types";

interface StorageBuildItemProps {
  cash: number;
  interestRate: number;
  location?: LocationType;
  storage: StorageShoppingType;
  onUseMaxSize: (peakWh: number) => void;
  onBuild: (financed: boolean) => void;
}

function StorageBuildItem(props: StorageBuildItemProps): React.JSX.Element {
  const { storage, cash } = props;
  const units = useUnits();
  const [open, setOpen] = React.useState(false);
  const { downpayment } = purchaseTerms(
    storage.buildCost,
    true,
    props.interestRate,
  );
  const sizeBuildable = props.storage.peakWh <= props.storage.maxPeakWh;
  const maxSizeWh = floorToTwoSignificantDigits(storage.maxPeakWh);
  const { buildable, secondaryText, offerMaxSize } = getBuildAvailability({
    name: storage.name,
    description: storage.description,
    available: storage.available,
    sizeBuildable,
    maxSizeLabel: formatWattHours(maxSizeWh),
    location: props.location,
    viableLocationsRemaining: storage.viableLocationsRemaining,
  });
  const sites = getSiteInventory(
    storage.name,
    props.location,
    storage.viableLocationsRemaining,
  );
  const shortfall = financingShortfallText(cash, downpayment);
  const buildSubtitle = (buildable && shortfall) || secondaryText;

  const openReview = (e: React.SyntheticEvent) => {
    setOpen(true);
    e.stopPropagation();
  };

  return (
    <BuildOptionCard
      name={storage.name}
      iconSrc={`/images/${storage.name.toLowerCase()}.svg`}
      review={{
        ariaLabel: `Review purchase of ${storage.name}`,
        disabled: !!shortfall || !buildable,
        onClick: openReview,
      }}
      sizeAction={
        offerMaxSize && (
          <Button size="small" onClick={() => props.onUseMaxSize(maxSizeWh)}>
            Use max size
          </Button>
        )
      }
      context={buildable && sites ? siteCountLabel(sites) : undefined}
      warning={!buildable || shortfall ? buildSubtitle : undefined}
      metrics={
        <>
          <BuildMetric
            label="Discharge power"
            value={formatWatts(storage.peakW)}
          />
          <BuildMetric
            label="Build cost"
            value={formatMoneyConcise(storage.buildCost)}
          />
          <BuildMetric
            label="Build time"
            value={`${Math.round(storage.yearsToBuild * 12)} mo`}
          />
          <BuildMetric
            label="Energy capacity"
            value={formatWattHours(storage.peakWh)}
          />
          <BuildMetric
            label="At full power"
            value={`${Number((storage.peakWh / storage.peakW).toFixed(1))} hr`}
          />
          <BuildMetric
            label="Round-trip efficiency"
            value={`${Math.round(storage.roundTripEfficiency * 100)}%`}
          />
        </>
      }
      details={
        <>
          <Typography
            className="buildOptionDescription"
            variant="body2"
            color="textSecondary"
          >
            {storage.description}
          </Typography>
          <TableContainer>
            <Table size="small" aria-label="storage properties">
              <TableBody>
                <TableRow>
                  <TableCell>Operating costs (/yr)</TableCell>
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
                <TableRow>
                  <TableCell>Lifespan</TableCell>
                  <TableCell align="right">
                    {storage.lifespanYears} years
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Stored energy lost per hour</TableCell>
                  <TableCell align="right">
                    {Number((storage.hourlyLoss * 100).toFixed(3))}%
                  </TableCell>
                </TableRow>
                <ViableLocationsRow sites={sites} />
                <TableRow>
                  <TableCell>Construction emissions</TableCell>
                  <TableCell align="right">
                    {`${formatLargeMassValueConcise(
                      (storage.constructionKgco2ePerWh || 0) * storage.peakWh,
                      units,
                    )} ${largeMassUnit(units)}`}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </>
      }
    >
      <PurchaseReviewDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Build ${formatWattHours(storage.peakWh)} ${storage.name}?`}
        cash={cash}
        buildCost={storage.buildCost}
        interestRate={props.interestRate}
        cashDisabled={!buildable}
        loanDisabled={!buildable}
        upkeepPerMonth={storage.annualOperatingCost / 12}
        upkeepDetail="Plus charging and loan payments."
        onlineInMonths={Math.round(storage.yearsToBuild * 12)}
        onPurchase={(financed) => {
          props.onBuild(financed);
          setOpen(false);
        }}
        extraFacts={[
          {
            concept: "storage",
            label: "Energy storage",
            value: formatWattHours(storage.peakWh),
          },
          {
            concept: "supply",
            label: "Charge/discharge rate",
            value: formatWatts(storage.peakW),
          },
          {
            concept: "supply",
            label: "Round-trip efficiency",
            value: `${Math.round(storage.roundTripEfficiency * 100)}%`,
          },
          ...(sites
            ? [
                {
                  concept: "build" as const,
                  label: "Project site",
                  value:
                    sites.remaining === 1
                      ? "Uses your last site"
                      : `Leaves ${sites.remaining - 1} of ${sites.total}`,
                  detail: "Each project takes one site, whatever its size.",
                },
              ]
            : []),
        ]}
      />
    </BuildOptionCard>
  );
}

type StorageSortKey = "buildCost" | "yearsToBuild";

const sortOptions: ReadonlyArray<readonly [StorageSortKey, string]> = [
  ["buildCost", "Build Cost"],
  ["yearsToBuild", "Build Time"],
];

function valueLabelFormat(x: number) {
  return formatWatts(sliderTickToW(x));
}

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onBuildStorage: (storage: StorageShoppingType, financed: boolean) => void;
  onBack: () => void;
}

export type Props = StateProps & DispatchProps;

export default function StorageBuildDialog(props: Props): React.JSX.Element {
  const { game, onBack } = props;
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const [sliderTick, setSliderTick] = React.useState<number>(() =>
    wToSliderTick(mostRecentBuiltSize(game.facilities, true)),
  );
  const [exactSizes, setExactSizes] = React.useState<Record<string, number>>(
    {},
  );
  const [sort, setSort] = React.useState<StorageSortKey>("buildCost");

  if (!now) {
    return <span />;
  }

  const cash = now.cash;
  const storage = STORAGE(game, sliderTickToW(sliderTick))
    .map((candidate) =>
      exactSizes[candidate.name] !== undefined
        ? STORAGE(game, exactSizes[candidate.name]).find(
            (resized) => resized.name === candidate.name,
          ) || candidate
        : candidate,
    )
    .sort((a, b) => a[sort] - b[sort]);

  return (
    <div className="flexContainer screenCatalog">
      <ConstructionBuildHeader
        capacity={`${valueLabelFormat(sliderTick)}h`}
        sliderValue={sliderTick}
        sliderMin={4}
        sliderMax={37}
        sort={sort}
        sortOptions={sortOptions}
        onSliderChange={(value) => {
          setSliderTick(value);
          setExactSizes({});
        }}
        onSortChange={(value) => setSort(value as StorageSortKey)}
      />
      <List dense className="scrollable cardList">
        {storage.map((g: StorageShoppingType, i: number) => (
          <StorageBuildItem
            storage={g}
            key={i}
            cash={cash}
            onUseMaxSize={(peakWh) => {
              setSliderTick(Math.max(0, wToSliderTick(peakWh)));
              setExactSizes((sizes) => ({ ...sizes, [g.name]: peakWh }));
            }}
            interestRate={game.interestRate}
            location={game.location}
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
