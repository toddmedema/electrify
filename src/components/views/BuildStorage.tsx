import TerritoryBuildDestination, {
  useTerritoryBuildDestination,
  useTerritoryBuildTile,
  territoryBuildTileName,
  territoryName,
} from "../base/TerritoryBuildDestination";
import {
  hasTerritoryNetwork,
  territoryBuildAvailability,
} from "../../helpers/Territories";
import type { TerritoryId, TerritoryTileId } from "../../Types";
import {
  getTerritoryTile,
  tileSupportsFacilityTechnology,
} from "../../helpers/TerritoryTiles";
import { useMoney } from "../base/CurrencyContext";
import { GameBuildCompleteContext } from "../base/GameWorkspaceContext";
import * as React from "react";
import {
  sameBuildQuote,
  useBuildAffordability,
  useBuildAffordabilityKey,
  useBuildCashReader,
} from "../base/useBuildCash";
import { useToolState, useToolScroll } from "../base/GameToolMemory";
import { Button, List, Typography } from "@mui/material";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { facilityLoanMonths, purchaseTerms } from "../../helpers/Financials";
import {
  floorToTwoSignificantDigits,
  formatNumber,
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
import { BuildCashWarning } from "../base/PurchaseReviewDialog";
import {
  getBuildAvailability,
  getSiteInventory,
  siteCountLabel,
} from "../base/BuildAvailability";
import BuildPurchaseReviewDialog, {
  finishBuildReview,
  type FacilityPurchaseSubmission,
} from "../base/BuildPurchaseReviewDialog";
import BuildMetric from "../base/BuildMetric";
import {
  formatLargeMassValueConcise,
  largeMassUnit,
} from "../../helpers/Units";
import { useUnits } from "../base/UnitsContext";
import ConstructionBuildHeader from "../base/ConstructionBuildHeader";
import useBuildRowReveal from "../base/useBuildRowReveal";
import { GameType, LocationType, StorageShoppingType } from "../../Types";

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
  /** Expanded canonical card without purchasing controls or dialogs. */
  preview?: boolean;
  previewSiteIssue?: string;
  game: GameType;
  cash: number;
  interestRate: number;
  location?: LocationType;
  storage: StorageShoppingType;
  minimumBuildCost: number;
  territoryAvailability?: ReturnType<typeof territoryBuildAvailability>;
  territoryId?: TerritoryId;
  tileId?: TerritoryTileId;
  lockedTile?: boolean;
  onUseMaxSize: (peakWh: number) => void;
  onBuild: (financed: boolean) => FacilityPurchaseSubmission;
  onBuilt?: () => void;
}

export function StorageBuildItem(
  props: StorageBuildItemProps,
): React.JSX.Element {
  const { formatMoneyConcise, formatPurchasePrice } = useMoney();
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
  const maxSizeWh = floorToTwoSignificantDigits(
    Math.min(
      storage.maxPeakWh,
      props.territoryAvailability
        ? (props.territoryAvailability.maxPeakW * storage.peakWh) /
            storage.peakW
        : Infinity,
    ),
  );
  const generalAvailability = getBuildAvailability({
    name: storage.name,
    description: storage.description,
    available: storage.available,
    sizeBuildable,
    maxSizeLabel: formatWattHours(maxSizeWh),
    location: props.location,
    viableLocationsRemaining: storage.viableLocationsRemaining,
  });
  const buildable =
    generalAvailability.buildable &&
    (props.territoryAvailability?.buildable ?? true);
  const secondaryText =
    props.territoryAvailability && !props.territoryAvailability.buildable
      ? props.territoryAvailability.reason
      : generalAvailability.secondaryText;
  const tile = props.tileId
    ? getTerritoryTile(props.tileId, props.game)
    : undefined;
  const offerMaxSize =
    (!tile || tileSupportsFacilityTechnology(tile, storage)) &&
    (generalAvailability.offerMaxSize ||
      (props.territoryAvailability &&
        storage.peakWh > maxSizeWh &&
        maxSizeWh > 0));
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
  const buildTileId = props.tileId ?? props.territoryAvailability?.tileId;

  const openReview = (e: React.SyntheticEvent) => {
    setOpen(true);
    e.stopPropagation();
  };

  if (
    !props.preview &&
    tile &&
    !tileSupportsFacilityTechnology(tile, storage)
  ) {
    return (
      <BuildOptionCard
        className="storageBuildOption"
        name={displayName}
        iconSrc={`/images/${storage.name.toLowerCase()}.svg`}
        context="Not buildable on this tile"
      />
    );
  }

  const siteMaxPower = props.territoryAvailability
    ? (maxSizeWh * storage.peakW) / storage.peakWh
    : undefined;
  const siteMaxPowerLabel =
    siteMaxPower !== undefined && Number.isFinite(siteMaxPower)
      ? `${formatWatts(siteMaxPower)} max power`
      : undefined;

  const dischargePower = (
    <BuildMetric
      asDetailRow={props.preview}
      label="Discharge power"
      entry={MANUAL_ENTRY.POWER_AND_ENERGY}
      value={formatWatts(storage.peakW)}
    />
  );
  const metrics = (
    <>
      {!props.preview && dischargePower}
      <BuildMetric
        asDetailRow={props.preview}
        label="Build cost"
        entry={MANUAL_ENTRY.TOTAL_COST_OF_ENERGY}
        value={formatPurchasePrice(storage.buildCost)}
      />
      <BuildMetric
        asDetailRow={props.preview}
        label="Build time"
        entry={MANUAL_ENTRY.HOW_TO_PLAY}
        value={`${Math.round(storage.yearsToBuild * 12)} mo`}
      />
      {props.preview && dischargePower}
      <BuildMetric
        asDetailRow={props.preview}
        label={props.preview ? "Duration at full power" : "At full power"}
        entry={MANUAL_ENTRY.POWER_AND_ENERGY}
        value={`${formatNumber(storage.peakWh / storage.peakW)} hr`}
      />
      <BuildMetric
        asDetailRow={props.preview}
        label={props.preview ? "Round-trip efficiency" : "Efficiency"}
        entry={MANUAL_ENTRY.ROUND_TRIP_EFFICIENCY}
        value={`${Math.round(storage.roundTripEfficiency * 100)}%`}
      />
    </>
  );

  return (
    <BuildOptionCard
      className="storageBuildOption"
      name={displayName}
      iconSrc={`/images/${storage.name.toLowerCase()}.svg`}
      preview={props.preview}
      description={props.preview ? storage.description : undefined}
      review={
        props.preview
          ? undefined
          : {
              ariaLabel: `Review purchase of ${displayName}`,
              disabled: !!shortfall || !buildable,
              onClick: openReview,
            }
      }
      sizeAction={
        (offerMaxSize || offerAffordableSize) &&
        (offerAffordableSize || storage.peakWh !== maxSizeWh) && (
          <Button size="small" onClick={() => props.onUseMaxSize(maxSizeWh)}>
            Use max size
          </Button>
        )
      }
      context={
        props.territoryAvailability
          ? props.tileId
            ? props.lockedTile
              ? siteMaxPowerLabel
              : [
                  "One building slot",
                  siteMaxPowerLabel && `${siteMaxPowerLabel} per project`,
                ]
                  .filter(Boolean)
                  .join(" · ")
            : [
                `${props.territoryAvailability.remaining} open-land sites left`,
                siteMaxPowerLabel && `${siteMaxPowerLabel} per project`,
              ]
                .filter(Boolean)
                .join(" · ")
          : buildable && sites
            ? siteCountLabel(sites)
            : undefined
      }
      summary={
        !props.preview && (
          <Typography
            className="buildOptionDescription"
            variant="body2"
            color="textSecondary"
          >
            {storageBuildSummary(storage)}
          </Typography>
        )
      }
      warning={
        props.previewSiteIssue ??
        (!buildable || shortfall ? buildSubtitle : undefined)
      }
      metrics={props.preview ? undefined : metrics}
      details={
        <BuildDetails label="storage properties">
          {props.preview && metrics}
          <BuildDetailRow
            label={props.preview ? "Fixed operating cost" : "Fixed"}
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
            value={`${formatNumber(storage.hourlyLoss * 100)}%`}
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
      <BuildPurchaseReviewDialog
        game={props.game}
        facility={storage}
        territoryId={props.territoryId}
        tileId={buildTileId}
        open={open}
        onClose={() => setOpen(false)}
        title={`Build ${formatWattHours(storage.peakWh)} ${displayName}?`}
        preface={
          props.territoryId &&
          !props.lockedTile && (
            <Typography sx={{ px: 2, mb: 2 }}>
              Build in {territoryName(props.territoryId)}
              {buildTileId
                ? ` · ${territoryBuildTileName(buildTileId, props.game, storage)}`
                : ""}
              . Storage charges from and supplies your company power pool.
            </Typography>
          )
        }
        cash={cash}
        buildCost={storage.buildCost}
        interestRate={props.interestRate}
        loanMonths={facilityLoanMonths(storage.lifespanYears)}
        cashDisabled={!buildable}
        loanDisabled={!buildable}
        upkeepPerMonth={storage.annualOperatingCost / 12}
        upkeepDetail="Plus charging and loan payments."
        onlineInMonths={Math.round(storage.yearsToBuild * 12)}
        onPurchase={(financed) =>
          finishBuildReview(props.onBuild(financed), () => {
            setOpen(false);
            props.onBuilt?.();
          })
        }
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
            label: "Efficiency",
            value: `${Math.round(storage.roundTripEfficiency * 100)}%`,
          },
          ...(sites && !props.lockedTile
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
    territoryId?: TerritoryId,
    tileId?: TerritoryTileId,
  ) => FacilityPurchaseSubmission;
  onBack: () => void;
}

export type Props = StateProps &
  DispatchProps & { lockedTileId?: TerritoryTileId };

function StorageBuildDialog(props: Props): React.JSX.Element {
  const completeBuild = React.useContext(GameBuildCompleteContext);
  const { game, onBack } = props;
  const [rememberedTerritoryId, setTerritoryId] =
    useTerritoryBuildDestination();
  const [rememberedTileId, setTileId] = useTerritoryBuildTile();
  const tileId = props.lockedTileId ?? rememberedTileId;
  const territoryId =
    (props.lockedTileId
      ? getTerritoryTile(props.lockedTileId, game)?.territoryId
      : undefined) ?? rememberedTerritoryId;
  const territoryNetwork = hasTerritoryNetwork(game);
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

  const cash = now?.cash ?? 0;
  const quoteStorage = (peakWh: number) =>
    STORAGE(game, peakWh, tileId, territoryNetwork ? territoryId : undefined);
  const minimumStorage = quoteStorage(sliderTickToW(4));
  const storage = quoteStorage(sliderTickToW(sliderTick)).map((candidate) =>
    exactSizes[candidate.name] !== undefined
      ? quoteStorage(exactSizes[candidate.name]).find(
          (resized) => resized.name === candidate.name,
        ) || candidate
      : candidate,
  );
  const territoryAvailabilityByName = new Map(
    storage.map((candidate) => [
      candidate.name,
      territoryNetwork
        ? territoryBuildAvailability(game, candidate, territoryId, tileId)
        : undefined,
    ]),
  );
  const affordability = useBuildAffordabilityKey(
    cash,
    storage.map(
      (candidate) =>
        purchaseTerms(candidate.buildCost, true, game.interestRate).downpayment,
    ),
  );
  const canReviewByName = new Map(
    storage.map((candidate, index) => [
      candidate.name,
      getBuildAvailability({
        name: candidate.name,
        description: candidate.description,
        available: candidate.available,
        sizeBuildable: candidate.peakWh <= candidate.maxPeakWh,
        maxSizeLabel: undefined,
        location: game.location,
        viableLocationsRemaining: candidate.viableLocationsRemaining,
      }).buildable &&
        (territoryAvailabilityByName.get(candidate.name)?.buildable ?? true) &&
        affordability[index] === "1",
    ]),
  );
  storage.sort(
    (a, b) =>
      Number(canReviewByName.get(b.name)) -
        Number(canReviewByName.get(a.name)) || a[sort] - b[sort],
  );

  if (!now) return <span />;

  return (
    <div className="flexContainer screenCatalog">
      {territoryNetwork && !props.lockedTileId && (
        <TerritoryBuildDestination
          game={game}
          value={territoryId}
          onChange={setTerritoryId}
          tileId={tileId}
          onTileChange={setTileId}
        />
      )}
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
          No storage projects available in {game.date.year} in{" "}
          {game.location.name}.
        </Typography>
      )}
      <List ref={listRef} dense className="scrollable cardList">
        {storage.map((g: StorageShoppingType) => (
          <StorageBuildItem
            lockedTile={!!props.lockedTileId}
            game={game}
            storage={g}
            territoryId={territoryNetwork ? territoryId : undefined}
            tileId={territoryNetwork ? tileId : undefined}
            territoryAvailability={territoryAvailabilityByName.get(g.name)}
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
                    quoteStorage(capacity).find((item) => item.name === g.name)!
                      .buildCost,
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
              if (territoryNetwork)
                return props.onBuildStorage(
                  g,
                  financed,
                  territoryId,
                  tileId ?? territoryAvailabilityByName.get(g.name)?.tileId,
                );
              return props.onBuildStorage(g, financed);
            }}
            onBuilt={completeBuild ?? onBack}
          />
        ))}
      </List>
    </div>
  );
}

export default React.memo(StorageBuildDialog, sameBuildQuote);
