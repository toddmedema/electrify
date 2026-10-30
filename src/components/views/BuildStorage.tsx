import { BuildOperatingAreaContext } from "../base/BuildOperatingAreaContext";
import { gameForOperatingArea } from "../../helpers/Expansion";
import { GameBuildCompleteContext } from "../base/GameWorkspaceContext";
import * as React from "react";
import {
  sameBuildQuote,
  useBuildAffordability,
  useBuildCashReader,
} from "../base/useBuildCash";
import { useToolState, useToolScroll } from "../base/GameToolMemory";
import { Button, List, Typography } from "@mui/material";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { facilityLoanMonths, purchaseTerms } from "../../helpers/Financials";
import {
  floorToTwoSignificantDigits,
  formatMoneyConcise,
  formatWattHours,
  formatWatts,
} from "../../helpers/Format";
import { STORAGE } from "../../data/Facilities";
import { MANUAL_ENTRY } from "../base/ManualEntries";
import BuildDetails, { BuildDetailRow } from "../base/BuildDetails";
import BuildOptionCard from "../base/BuildOptionCard";
import {
  averageBuildSize,
  buildSizeOptions,
  largestAffordableBuildSize,
  sliderTickToW,
  wToSliderTick,
} from "../../helpers/BuildSizing";
import {
  LivePurchaseReviewDialog as PurchaseReviewDialog,
  BuildCashWarning,
} from "../base/PurchaseReviewDialog";
import {
  getBuildAvailability,
  getSiteInventory,
  siteCountLabel,
} from "../base/BuildAvailability";
import BuildMetric from "../base/BuildMetric";
import {
  formatLargeMassValueConcise,
  largeMassUnit,
} from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import useBuildRowReveal from "../base/useBuildRowReveal";
import {
  GameType,
  LocationType,
  StorageShoppingType,
  UtilityAreaId,
} from "../../Types";

function storageBuildSummary(storage: StorageShoppingType): string {
  switch (storage.name) {
    case "Battery":
      return "Fast response, four hours of power";
    case "Iron-Air Battery":
      return "100 hours of power; low charging efficiency";
    case "Pumped Hydro":
      return "Reservoir storage; slow to build";
    default:
      return storage.description;
  }
}

interface StorageBuildItemProps {
  cash: number;
  interestRate: number;
  location?: LocationType;
  storage: StorageShoppingType;
  minimumBuildCost: number;
  onUseMaxSize: (peakWh: number) => void;
  onBuild: (financed: boolean) => void;
}

function StorageBuildItem(props: StorageBuildItemProps): React.JSX.Element {
  const { storage, cash } = props;
  // The catalog key also identifies facilities in saves and mods.
  const displayName =
    storage.name === "Battery" ? "Lithium Battery" : storage.name;
  const units = useUnits();
  const [open, setOpen] = React.useState(false);
  const { downpayment } = purchaseTerms(
    storage.buildCost,
    true,
    props.interestRate,
  );
  const affordable = useBuildAffordability(cash, downpayment);
  const minimumAffordable = useBuildAffordability(
    cash,
    purchaseTerms(props.minimumBuildCost ?? Infinity, true, props.interestRate)
      .downpayment,
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
  const shortfall = !affordable ? (
    <BuildCashWarning cash={cash} downpayment={downpayment} />
  ) : undefined;
  const buildSubtitle = (buildable && shortfall) || secondaryText;
  const offerAffordableSize = buildable && !!shortfall && minimumAffordable;

  const openReview = (e: React.SyntheticEvent) => {
    setOpen(true);
    e.stopPropagation();
  };

  return (
    <BuildOptionCard
      className="storageBuildOption"
      name={displayName}
      iconSrc={`/images/${storage.name.toLowerCase()}.svg`}
      review={{
        ariaLabel: `Review purchase of ${displayName}`,
        disabled: !!shortfall || !buildable,
        onClick: openReview,
      }}
      sizeAction={
        (offerMaxSize || offerAffordableSize) &&
        (offerAffordableSize || storage.peakWh !== maxSizeWh) && (
          <Button size="small" onClick={() => props.onUseMaxSize(maxSizeWh)}>
            Use max size
          </Button>
        )
      }
      context={buildable && sites ? siteCountLabel(sites) : undefined}
      summary={
        <Typography
          className="buildOptionDescription"
          variant="body2"
          color="textSecondary"
        >
          {storageBuildSummary(storage)}
        </Typography>
      }
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
        <BuildDetails label="storage properties">
          <BuildDetailRow
            label="Operating costs"
            value={`${formatMoneyConcise(storage.annualOperatingCost)}/yr`}
            entry={MANUAL_ENTRY.OPERATING_COSTS}
          />
          <BuildDetailRow
            label="Ramp up/down time"
            value={`${storage.spinMinutes} min`}
            entry={MANUAL_ENTRY.RAMP_RATE}
          />
          <BuildDetailRow
            label="Accounting lifetime"
            value={`${storage.lifespanYears} years`}
            entry={MANUAL_ENTRY.ACCOUNTING_LIFETIME}
          />
          <BuildDetailRow
            label="Stored energy lost per hour"
            value={`${Number((storage.hourlyLoss * 100).toFixed(3))}%`}
            entry={MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY}
          />
          {sites && (
            <BuildDetailRow
              label="Sites left"
              value={`${sites.remaining} of ${sites.total}`}
              entry={MANUAL_ENTRY.PROJECT_SITES}
            />
          )}
          <BuildDetailRow
            label="Construction emissions"
            value={`${formatLargeMassValueConcise(
              (storage.constructionKgco2ePerWh || 0) * storage.peakWh,
              units,
            )} ${largeMassUnit(units)}`}
            entry={MANUAL_ENTRY.EMISSIONS}
          />
        </BuildDetails>
      }
    >
      <PurchaseReviewDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Build ${formatWattHours(storage.peakWh)} ${displayName}?`}
        cash={cash}
        buildCost={storage.buildCost}
        interestRate={props.interestRate}
        loanMonths={facilityLoanMonths(storage.lifespanYears)}
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
  ["buildCost", "Build cost"],
  ["yearsToBuild", "Build time"],
];

function valueLabelFormat(x: number) {
  return formatWatts(sliderTickToW(x));
}

export interface StateProps {
  game: GameType;
}

export interface DispatchProps {
  onBuildStorage: (
    storage: StorageShoppingType,
    financed: boolean,
    operatingAreaId?: UtilityAreaId,
  ) => void;
  onBack: () => void;
}

export type Props = StateProps & DispatchProps;

function StorageBuildDialog(props: Props): React.JSX.Element {
  const completeBuild = React.useContext(GameBuildCompleteContext);
  const { onBack } = props;
  const operatingAreaId = React.useContext(BuildOperatingAreaContext);
  const game = React.useMemo(
    () =>
      operatingAreaId
        ? (gameForOperatingArea(props.game, operatingAreaId) ?? props.game)
        : props.game,
    [props.game, operatingAreaId],
  );
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  const readCash = useBuildCashReader(now?.cash ?? 0);
  const listRef = useToolScroll<HTMLUListElement>("storage.scroll");
  const revealResizedRow = useBuildRowReveal(listRef);
  const [sliderTick, setSliderTick] = useToolState<number>("storage.size", () =>
    Math.max(
      4,
      Math.min(37, wToSliderTick(averageBuildSize(game.facilities, true))),
    ),
  );
  const [exactSizes, setExactSizes] = useToolState<Record<string, number>>(
    "storage.exactSizes",
    {},
  );
  const [sort, setSort] = useToolState<StorageSortKey>(
    "storage.sort",
    "buildCost",
  );

  if (!now) {
    return <span />;
  }

  const cash = now.cash;
  const minimumStorage = STORAGE(game, sliderTickToW(4));
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
      {storage.length === 0 && (
        <Typography role="status" sx={{ px: 2, py: 2 }}>
          No storage projects are available in this operating area in{" "}
          {game.date.year}.
        </Typography>
      )}
      <List ref={listRef} dense className="scrollable cardList">
        {storage.map((g: StorageShoppingType) => (
          <StorageBuildItem
            storage={g}
            key={g.name}
            cash={cash}
            minimumBuildCost={
              minimumStorage.find((item) => item.name === g.name)!.buildCost
            }
            onUseMaxSize={(peakWh) => {
              const size =
                largestAffordableBuildSize(
                  buildSizeOptions(4, 37, peakWh),
                  readCash(),
                  (capacity) =>
                    STORAGE(game, capacity).find(
                      (item) => item.name === g.name,
                    )!.buildCost,
                ) ?? peakWh;
              revealResizedRow(
                g.name === "Battery" ? "Lithium Battery" : g.name,
              );
              setSliderTick(Math.max(4, wToSliderTick(size)));
              setExactSizes((sizes) => ({ ...sizes, [g.name]: size }));
            }}
            interestRate={game.interestRate}
            location={game.location}
            onBuild={(financed: boolean) => {
              if (operatingAreaId)
                props.onBuildStorage(g, financed, operatingAreaId);
              else props.onBuildStorage(g, financed);
              (completeBuild ?? onBack)();
            }}
          />
        ))}
      </List>
    </div>
  );
}

export default React.memo(StorageBuildDialog, sameBuildQuote);
