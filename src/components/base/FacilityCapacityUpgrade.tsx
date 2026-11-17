import * as React from "react";
import {
  Button,
  DialogContentText,
  LinearProgress,
  TextField,
  Typography,
} from "@mui/material";
import type {
  ExpandFacilityAction,
  FacilityExpansionInProgressType,
  FacilityOperatingType,
  GameType,
} from "../../Types";
import { isStorage } from "../../Types";
import { facilityExpansionQuote } from "../../helpers/FacilityExpansion";
import { facilityPermanentlyShutdown } from "../../helpers/Financials";
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
import { useMoney } from "./CurrencyContext";
import { facilityDisplayName } from "./FacilityLabels";
import ConfirmDialog from "./ConfirmDialog";
import DecisionImpactPreview from "./DecisionImpactPreview";
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
}: {
  facility: FacilityOperatingType;
  game: GameType;
} & FacilityCapacityUpgradeActions) {
  const money = useMoney(currencyForLocation(game.location, game.startingYear));
  const storage = isStorage(facility);
  const size = facility.peakWh ?? facility.peakW;
  const unit = storage ? "MWh" : "MW";
  const capacity = storage ? formatWattHours : formatWatts;
  const availability = facilityExpansionQuote(game, facility.id, size + 1);
  const maximum = availability.maxSize;
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState("");
  const [reviewedKey, setReviewedKey] = React.useState<string>();
  const [cancelReview, setCancelReview] =
    React.useState<FacilityExpansionInProgressType>();
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string>();
  const submitting = React.useRef(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const unavailableId = React.useId();
  const focusHeading = React.useRef(false);
  React.useEffect(() => {
    if (!open && !cancelReview && focusHeading.current) {
      focusHeading.current = false;
      heading.current?.focus();
    }
  }, [open, cancelReview]);
  const targetSize = target.trim() ? Number(target) * 1e6 : NaN;
  const quote = facilityExpansionQuote(game, facility.id, targetSize);
  const ready = quote.status === "ready" ? quote : undefined;
  const cash = currentCash(game);
  const shortfall = ready ? Math.max(0, ready.cost - cash) : 0;
  const changed = !!ready && ready.quoteKey !== reviewedKey;
  const expansion = facility.expansionInProgress;
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
    availability.status === "unavailable" ? availability.reason : undefined;
  const offer = !!onExpand && availability.status === "ready";
  const changeTarget = (value: string) => {
    setTarget(value);
    setMessage(undefined);
    const next = facilityExpansionQuote(game, facility.id, Number(value) * 1e6);
    setReviewedKey(next.status === "ready" ? next.quoteKey : undefined);
  };
  const close = () => {
    if (submitting.current) return;
    setOpen(false);
    setCancelReview(undefined);
    setMessage(undefined);
  };
  const start = async () => {
    if (submitting.current || !ready || changed || shortfall > 0 || !onExpand)
      return;
    submitting.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      const result = await onExpand({
        facilityId: facility.id,
        targetSize: ready.targetSize,
        quoteKey: ready.quoteKey,
      });
      if (result.status === "accepted") {
        focusHeading.current = true;
        setOpen(false);
      } else {
        setMessage(result.message);
        setReviewedKey(undefined);
      }
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "The upgrade was not confirmed. Try again.",
      );
      setReviewedKey(undefined);
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
        focusHeading.current = true;
        setCancelReview(undefined);
        setMessage(
          result.status === "completed"
            ? result.message
            : `Capacity upgrade canceled. ${money.formatMoneyConcise(result.refund)} refunded.`,
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
    facilityPermanentlyShutdown(facility, game.date.minute)
  )
    return null;
  return (
    <section
      className="facilityDetailSection facilityCapacityUpgrade"
      aria-label="Capacity upgrade"
    >
      <Typography
        component="h3"
        className="facilityDetailHeading"
        ref={heading}
        tabIndex={-1}
      >
        Capacity upgrade
      </Typography>
      {expansion ? (
        <>
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
            Current capacity remains available until the added capacity is
            ready.
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
              const next = Math.min(
                maximum ?? Infinity,
                size + Math.max(1e6, size / 4),
              );
              changeTarget(String(next / 1e6));
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
        <ConfirmDialog
          open
          isolateClicks
          title={`Upgrade ${facilityDisplayName(facility)} capacity`}
          contentClassName="facilityCapacityDialog"
          pending={pending}
          confirmLabel={
            pending
              ? "Waiting for confirmation…"
              : ready
                ? `Pay ${money.formatMoneyConcise(ready.cost)}`
                : "Upgrade capacity"
          }
          confirmDisabled={!ready || changed || shortfall > 0}
          onCancel={close}
          onConfirm={() => {
            void start();
          }}
        >
          <div className="facilityCapacityControls">
            <TextField
              label={`New capacity (${unit})`}
              type="number"
              value={target}
              disabled={pending}
              onChange={(event) => changeTarget(event.target.value)}
              slotProps={{
                htmlInput: {
                  min: size / 1e6,
                  max: maximum === undefined ? undefined : maximum / 1e6,
                  step: "any",
                },
              }}
            />
            <Button
              variant="outlined"
              disabled={pending || maximum === undefined || maximum <= size}
              onClick={() => {
                if (maximum !== undefined) changeTarget(String(maximum / 1e6));
              }}
            >
              Use maximum
            </Button>
          </div>
          {maximum !== undefined && (
            <DialogContentText>
              Site and technology limit: {formatNumber(maximum / 1e6)} {unit}.
            </DialogContentText>
          )}
          {ready && (
            <DecisionImpactPreview
              facts={[
                {
                  concept: storage ? "storage" : "supply",
                  label: "Capacity",
                  value: `${capacity(ready.currentSize)} → ${capacity(ready.targetSize)}`,
                  detail: `Adds ${capacity(ready.deltaSize)} at this plant.`,
                },
                {
                  concept: "money",
                  label: "Added capital cost",
                  value: money.formatMoneyConcise(ready.cost),
                  detail:
                    "Larger plant quote minus the equivalent current-capacity quote, both at today's prices.",
                },
                {
                  concept: "money",
                  label: "Cash remaining",
                  value: money.formatMoneyConcise(cash - ready.cost),
                },
                {
                  concept: "time",
                  label: "Construction time",
                  value: formatBuildMonths(ready.yearsToBuild, "long"),
                  detail:
                    "Current capacity keeps operating. Added capacity becomes available on completion.",
                },
              ]}
            />
          )}
          {!ready && (
            <DialogContentText role="alert">
              {quote.status === "unavailable"
                ? quote.reason
                : "Choose a larger capacity."}
            </DialogContentText>
          )}
          {shortfall > 0 && (
            <DialogContentText role="alert">
              {money.formatMoneyConcise(shortfall)} more cash needed.
            </DialogContentText>
          )}
          {changed && (
            <div className="facilityCapacityReview">
              <DialogContentText>
                The quote changed. Review these updated terms before paying.
              </DialogContentText>
              <Button
                disabled={pending}
                onClick={() => {
                  setReviewedKey(ready?.quoteKey);
                  setMessage(undefined);
                }}
              >
                Review updated quote
              </Button>
            </div>
          )}
          {message && (
            <DialogContentText role="alert">{message}</DialogContentText>
          )}
          <DialogContentText>
            Cash purchase. Cancel before completion for a full refund.
            Construction emissions already released remain recorded.
          </DialogContentText>
        </ConfirmDialog>
      )}
      {cancelReview && (
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
            Cancel the added capacity at {facilityDisplayName(facility)} for a
            full refund of {money.formatMoneyConcise(cancelReview.cost)}. The
            existing {capacity(size)} plant keeps operating. Construction
            emissions already released remain recorded.
          </DialogContentText>
          {message && (
            <DialogContentText role="alert">{message}</DialogContentText>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
