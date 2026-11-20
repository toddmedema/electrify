import * as React from "react";
import {
  Button,
  DialogContentText,
  LinearProgress,
  Slider,
  Typography,
} from "@mui/material";
import type {
  ExpandFacilityAction,
  FacilityExpansionInProgressType,
  FacilityOperatingType,
  GameType,
} from "../../Types";
import { isStorage } from "../../Types";
import {
  generatorMaxPeakW,
  storageMaxPeakWh,
  storagePowerW,
} from "../../data/FacilityCapacity";
import { getHydroSite } from "../../data/HydroSites";
import {
  getTerritoryTile,
  hasTerritoryNetwork,
  territoryTilePowerLimit,
  tileSupportsFacilityTechnology,
} from "../../helpers/TerritoryTiles";
import {
  facilityExpansionQuote,
  facilityExpansionRefund,
  financeFacilityExpansionQuote,
} from "../../helpers/FacilityExpansion";
import {
  facilityLoanMonths,
  facilityPermanentlyShutdown,
} from "../../helpers/Financials";
import { getInflationIndex } from "../../data/Economy";
import { currentCash } from "../../helpers/GameSelectors";
import {
  formatBuildMonths,
  formatNumber,
  formatWatts,
  formatWattHours,
} from "../../helpers/Format";
import { currencyForLocation } from "../../helpers/Currency";
import type {
  FacilityExpansionRequestResult,
  FacilityExpansionCancellationResult,
} from "../../helpers/RequestFacilityExpansion";
import { CurrencyContext, useMoney } from "./CurrencyContext";
import ConfirmDialog from "./ConfirmDialog";
import PurchaseReviewDialog from "./PurchaseReviewDialog";
import { signature } from "./DeferredProjection";
import "./FacilityCapacityUpgrade.scss";

export interface FacilityCapacityUpgradeActions {
  onExpand?: (
    payload: ExpandFacilityAction,
  ) => Promise<FacilityExpansionRequestResult>;
  onCancelExpansion?: (
    facilityId: number,
    quoteKey: string,
  ) => Promise<FacilityExpansionCancellationResult>;
}

/** The quote and host acceptance belong to the domain; this component only reviews their terms. */
export default function FacilityCapacityUpgrade({
  facility,
  game,
  onExpand,
  onCancelExpansion,
  openOnMount = false,
}: {
  facility: FacilityOperatingType;
  game: GameType;
  openOnMount?: boolean;
} & FacilityCapacityUpgradeActions) {
  const currency = currencyForLocation(game.location, game.startingYear);
  const money = useMoney(currency);
  const storage = isStorage(facility);
  const size = facility.peakWh ?? facility.peakW;
  const unit = storage ? "MWh" : "MW";
  const capacity = storage ? formatWattHours : formatWatts;
  // Closed inspectors need physical eligibility, not three complete economic catalogues per tick.
  const tile = facility.tileId
    ? getTerritoryTile(facility.tileId, game)
    : undefined;
  const technologyMaximum = storage
    ? storageMaxPeakWh(facility.name, game.date.year)
    : generatorMaxPeakW(
        game,
        facility.name,
        getHydroSite(facility.hydroSiteId ?? "")?.maxPeakW,
      );
  const wattsPerSize = storage ? storagePowerW(facility.name, 1) : 1;
  const physicalMaximum = Math.min(
    technologyMaximum,
    tile
      ? size +
          (territoryTilePowerLimit(tile, facility) - facility.peakW) /
            wattsPerSize
      : Infinity,
  );
  const physicalUnavailable = facility.upgradeInProgress
    ? "Finish the existing retrofit first."
    : hasTerritoryNetwork(game) &&
        (!tile || !tileSupportsFacilityTechnology(tile, facility))
      ? "This plant has no expandable building tile."
      : physicalMaximum <= size
        ? "This capacity exceeds the technology or site limit."
        : undefined;
  const expandOnMount =
    openOnMount &&
    !!onExpand &&
    !physicalUnavailable &&
    !facility.expansionInProgress;
  const initialTarget = Math.min(
    physicalMaximum,
    size + Math.max(1, Math.round(size / 4e6)) * 1e6,
  );
  const [open, setOpen] = React.useState(expandOnMount);
  const [targetSize, setTargetSize] = React.useState(initialTarget);
  const [reviewedKey, setReviewedKey] = React.useState(() => {
    if (!expandOnMount) return undefined;
    const initialQuote = facilityExpansionQuote(
      game,
      facility.id,
      initialTarget,
      true,
    );
    return initialQuote.status === "ready" ? initialQuote.quoteKey : undefined;
  });
  const [cancelReview, setCancelReview] = React.useState<
    FacilityExpansionInProgressType | undefined
  >(
    openOnMount && onCancelExpansion ? facility.expansionInProgress : undefined,
  );
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string>();
  const submitting = React.useRef(false);
  const upgradeSection = React.useRef<HTMLElement>(null);
  const unavailableId = React.useId();
  const focusUpgradeSection = React.useRef(false);
  React.useEffect(() => {
    if (!open && !cancelReview && focusUpgradeSection.current) {
      focusUpgradeSection.current = false;
      upgradeSection.current?.focus();
    }
  }, [open, cancelReview]);
  const pricingKey = open
    ? JSON.stringify([
        signature(game),
        game.date.month,
        game.date.monthNumber,
        game.commissionedHydroSiteIds,
        facility.name,
        facility.tileId,
        facility.territoryId,
        facility.hydroSiteId,
        facility.resilience,
        facility.costIndexAtBuild,
        facility.expansionSequence,
        facilityPermanentlyShutdown(facility, game.date.minute),
      ])
    : undefined;
  const { id: facilityId } = facility;
  const availability = React.useMemo(
    () =>
      pricingKey === undefined
        ? undefined
        : facilityExpansionQuote(game, facilityId, size + 1),
    // Pricing changes with the planning inputs, while cash is checked live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, facilityId, size],
  );
  const maximum = availability?.maxSize ?? physicalMaximum;
  const selectedSize = Math.max(size, Math.min(targetSize, maximum));
  const sliderSteps = Math.max(0, Math.ceil((maximum - size) / 1e6));
  // Use integer slider steps, preserving both exact bounds even for fractional MW caps.
  const capacityAtStep = (step: number) =>
    Math.max(size, Math.min(maximum, size + step * 1e6));
  const selectedStep =
    selectedSize === maximum
      ? sliderSteps
      : Math.round((selectedSize - size) / 1e6);
  const quote = React.useMemo(
    () =>
      pricingKey === undefined
        ? undefined
        : facilityExpansionQuote(game, facilityId, selectedSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pricingKey, facilityId, size, selectedSize],
  );
  const ready = quote?.status === "ready" ? quote : undefined;
  const cash = currentCash(game);
  const months = facilityLoanMonths(facility.lifespanYears);
  const loanQuote =
    ready && financeFacilityExpansionQuote(ready, game.interestRate, months);
  const changed = !!loanQuote && loanQuote.quoteKey !== reviewedKey;
  const expansion = facility.expansionInProgress;
  const cancelTerms =
    expansion?.quoteKey === cancelReview?.quoteKey ? expansion : cancelReview;
  const progress = expansion
    ? Math.max(
        0,
        Math.min(
          100,
          100 * (1 - expansion.yearsToBuildLeft / expansion.yearsToBuild),
        ),
      )
    : 0;
  const unavailable =
    availability?.status === "unavailable"
      ? availability.reason
      : physicalUnavailable;
  const offer = !!onExpand && !unavailable;
  const changeTarget = (value: number) => {
    setTargetSize(value);
    setMessage(undefined);
    const next = facilityExpansionQuote(game, facility.id, value, true);
    setReviewedKey(next.status === "ready" ? next.quoteKey : undefined);
  };
  const close = () => {
    if (submitting.current) return;
    setOpen(false);
    setCancelReview(undefined);
    setMessage(undefined);
  };
  const start = async (financed: boolean) => {
    const purchase = financed ? loanQuote : ready;
    if (
      submitting.current ||
      !purchase ||
      changed ||
      cash < purchase.amountDue ||
      !onExpand
    )
      return false;
    submitting.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      const result = await onExpand({
        facilityId: facility.id,
        targetSize: purchase.targetSize,
        quoteKey: purchase.quoteKey,
        ...(financed && { financed }),
      });
      if (result.status === "accepted") {
        focusUpgradeSection.current = true;
        setOpen(false);
        return true;
      }
      setReviewedKey(undefined);
      return result.message;
    } catch (cause) {
      setReviewedKey(undefined);
      return cause instanceof Error
        ? cause.message
        : "The upgrade was not confirmed. Try again.";
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const cancel = async () => {
    if (submitting.current || !cancelReview || !onCancelExpansion) return;
    submitting.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      const result = await onCancelExpansion(
        facility.id,
        cancelReview.quoteKey,
      );
      if (result.status === "rejected") setMessage(result.message);
      else {
        focusUpgradeSection.current = true;
        setCancelReview(undefined);
        setMessage(
          result.status === "completed"
            ? result.message
            : result.refund === undefined
              ? "Capacity upgrade canceled and its loan settled."
              : `Capacity upgrade canceled. ${money.formatPurchasePrice(result.refund)} refunded.`,
        );
      }
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Cancellation was not confirmed. Try again.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  if (
    (!onExpand && !expansion) ||
    facility.yearsToBuildLeft > 0 ||
    (facilityPermanentlyShutdown(facility, game.date.minute) && !expansion)
  )
    return null;
  return (
    <section
      className="facilityDetailSection facilityCapacityUpgrade"
      aria-label="Capacity upgrade"
      ref={upgradeSection}
      tabIndex={-1}
    >
      {expansion ? (
        <>
          <Typography component="h3" className="facilityDetailHeading">
            Capacity upgrade
          </Typography>
          <Typography variant="body2">
            {capacity(size)} → {capacity(expansion.targetSize)}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            {formatBuildMonths(expansion.yearsToBuildLeft, "long")} left ·{" "}
            {Math.round(progress)}% built
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress}
            aria-label="Capacity upgrade construction"
          />
          <Typography variant="body2" color="textSecondary">
            Only the added capacity is under construction.
          </Typography>
          {onCancelExpansion && (
            <Button
              variant="outlined"
              disabled={pending}
              onClick={() => {
                setMessage(undefined);
                setCancelReview(expansion);
              }}
            >
              Cancel capacity upgrade
            </Button>
          )}
        </>
      ) : (
        <>
          <Button
            variant="outlined"
            disabled={!offer || pending}
            aria-describedby={!offer ? unavailableId : undefined}
            onClick={() => {
              changeTarget(initialTarget);
              setOpen(true);
            }}
          >
            Upgrade capacity
          </Button>
          {unavailable && (
            <Typography
              id={unavailableId}
              variant="body2"
              color="textSecondary"
            >
              {unavailable}
            </Typography>
          )}
        </>
      )}
      {message && !open && !cancelReview && (
        <Typography role="status" variant="body2">
          {message}
        </Typography>
      )}
      {open && (
        <CurrencyContext.Provider value={currency}>
          <PurchaseReviewDialog
            open
            isolateClicks
            title={`Upgrade ${facility.name} capacity?`}
            cash={cash}
            buildCost={ready?.cost ?? 0}
            interestRate={game.interestRate}
            loanMonths={months}
            cashDisabled={!ready || changed}
            loanDisabled={!ready || changed}
            hideFacts={!ready}
            cashLabel="Cash option"
            upkeepLabel="Added maintenance"
            upkeepPerMonth={
              ((ready?.annualOperatingCostDelta ?? 0) *
                getInflationIndex(game.date, game.startingYear, game.seed)) /
              ((facility.costIndexAtBuild ?? 1) * 12)
            }
            onlineInMonths={ready && Math.round(ready.yearsToBuild * 12)}
            onlineInLabel="Added capacity online in"
            cancelLabel="Cancel"
            onClose={close}
            onPurchase={start}
            preface={
              <div className="facilityCapacityControls constructionControls">
                <Typography className="constructionCapacity" variant="body2">
                  <strong>
                    {formatNumber(selectedSize / 1e6, { notation: "standard" })}{" "}
                    {unit}
                  </strong>
                </Typography>
                <Slider
                  aria-label={`New capacity (${unit})`}
                  className="constructionCapacitySlider"
                  disabled={pending || sliderSteps === 0}
                  scale={(step) => capacityAtStep(step) / 1e6}
                  getAriaValueText={(value) =>
                    `${formatNumber(value, { notation: "standard" })} ${unit}`
                  }
                  min={0}
                  max={Math.max(1, sliderSteps)}
                  step={1}
                  value={selectedStep}
                  onChange={(_event, value) => {
                    if (typeof value === "number")
                      changeTarget(capacityAtStep(value));
                  }}
                />
              </div>
            }
            afterFacts={
              <div className="facilityCapacityNotes">
                {ready ? (
                  <Typography variant="body2" color="textSecondary">
                    Current capacity keeps operating during construction.
                  </Typography>
                ) : (
                  <DialogContentText>
                    {quote?.status === "unavailable"
                      ? quote.reason
                      : "Choose a larger capacity."}
                  </DialogContentText>
                )}
                {changed && (
                  <div className="facilityCapacityReview">
                    <DialogContentText>
                      The quote changed. Review the updated terms before paying.
                    </DialogContentText>
                    <Button
                      disabled={pending}
                      onClick={() => {
                        setReviewedKey(loanQuote?.quoteKey);
                      }}
                    >
                      Review updated quote
                    </Button>
                  </div>
                )}
              </div>
            }
          />
        </CurrencyContext.Provider>
      )}
      {cancelReview && cancelTerms && (
        <ConfirmDialog
          open
          isolateClicks
          destructive
          title="Cancel capacity upgrade?"
          pending={pending}
          confirmLabel={
            pending ? "Waiting for confirmation…" : "Cancel upgrade"
          }
          cancelLabel="Keep building"
          onCancel={close}
          onConfirm={() => {
            void cancel();
          }}
        >
          <DialogContentText>
            Cancel the added capacity at {facility.name}.{" "}
            {cancelTerms.loan
              ? `The loan will be settled and ${money.formatPurchasePrice(facilityExpansionRefund(cancelTerms))} refunded.`
              : `You will receive a full refund of ${money.formatPurchasePrice(cancelTerms.cost)}.`}{" "}
            The existing {capacity(size)} plant keeps operating.
          </DialogContentText>
          {message && (
            <DialogContentText role="alert">{message}</DialogContentText>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
