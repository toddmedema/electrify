import * as React from "react";
import { Typography } from "@mui/material";
import {
  COAL_REPOWER_UPGRADES,
  CoalRepowerType,
  FacilityOperatingType,
  GameType,
  RetrofitFacilityAction,
} from "../../Types";
import {
  COAL_REPOWER_OPTIONS,
  coalRepowerInProgress,
  coalRepowerQuote,
} from "../../helpers/CoalRepower";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { formatNumber, formatPercent, formatWatts } from "../../helpers/Format";
import { currentCash } from "../../helpers/GameSelectors";
import { upgradeProgress } from "../../helpers/Hazards";
import ConfirmDialog from "./ConfirmDialog";
import { useMoney } from "./CurrencyContext";
import DecisionImpactPreview from "./DecisionImpactPreview";
import FacilityUpgradeAction from "./FacilityUpgradeAction";

export function coalRepowerActionLabel(kind: CoalRepowerType): string {
  return `Convert to ${COAL_REPOWER_OPTIONS[kind].name}`;
}

function projectMonths(minutes: number): string {
  const months = minutes / MINUTES_PER_MONTH;
  return formatNumber(months, { maximumFractionDigits: 1 });
}

export function CoalRepowerReview({
  facility,
  game,
  kind,
  onClose,
  onRetrofit,
}: {
  facility: FacilityOperatingType;
  game: GameType;
  kind: CoalRepowerType;
  onClose: () => void;
  onRetrofit: (payload: RetrofitFacilityAction) => void;
}) {
  const { formatMoneyConcise } = useMoney();
  const quote = coalRepowerQuote(facility, game, kind);
  if (!quote) return null;

  const { cost, durationMinutes, target } = quote;
  const cash = currentCash(game);
  const canAfford = cash >= cost;
  const capacity = formatWatts(target.peakW);
  return (
    <ConfirmDialog
      open
      isolateClicks
      contentClassName="noPadding"
      title={`${coalRepowerActionLabel(kind)}?`}
      confirmLabel={`Pay ${formatMoneyConcise(cost)}`}
      confirmDisabled={!canAfford}
      onCancel={onClose}
      onConfirm={() => {
        if (canAfford) onRetrofit({ facilityId: facility.id, upgrade: kind });
        onClose();
      }}
    >
      <DecisionImpactPreview
        facts={[
          {
            concept: "money",
            label: "Cash purchase",
            value: canAfford
              ? `${formatMoneyConcise(cash)} → ${formatMoneyConcise(cash - cost)}`
              : `${formatMoneyConcise(cost - cash)} more cash needed`,
            detail:
              "Cancel before completion for a full refund. Existing loans stay payable.",
          },
          {
            concept: "time",
            label: "Construction",
            value: `${projectMonths(durationMinutes)} months`,
            detail:
              "Coal can keep running while the gas plant is built. The gas plant takes over at completion.",
          },
          {
            concept: "supply",
            label: "Rated capacity",
            value:
              target.peakW === facility.peakW
                ? capacity
                : `${formatWatts(facility.peakW)} → ${capacity}`,
            detail: `The new gas plant begins a ${target.lifespanYears}-year service life.`,
          },
          {
            concept: "fuel",
            label: "Fuel and start time",
            value: `Natural Gas · ${target.spinMinutes} min`,
            detail: `${formatNumber(target.btuPerWh * 1000)} Btu/kWh · ${formatPercent(target.minimumStableOutput ?? 0)} minimum output`,
          },
        ]}
      />
    </ConfirmDialog>
  );
}

export default function CoalRepower({
  facility,
  game,
  onRetrofit,
}: {
  facility: FacilityOperatingType;
  game: GameType;
  onRetrofit?: (payload: RetrofitFacilityAction) => void;
}) {
  const [review, setReview] = React.useState<CoalRepowerType>();
  const project = coalRepowerInProgress(facility);
  const options = onRetrofit
    ? COAL_REPOWER_UPGRADES.flatMap((kind) => {
        const quote = coalRepowerQuote(facility, game, kind);
        return quote ? [{ kind, quote }] : [];
      })
    : [];
  const reviewAvailable = options.some(({ kind }) => kind === review);
  React.useEffect(() => {
    if (review && !reviewAvailable) setReview(undefined);
  }, [review, reviewAvailable]);

  if (!project && !options.length) return null;
  const cash = currentCash(game);
  return (
    <section className="facilityDetailSection" aria-label="Coal repowering">
      <Typography component="h3" className="facilityDetailHeading">
        Repower with natural gas
      </Typography>
      {project ? (
        <Typography variant="body2">
          {COAL_REPOWER_OPTIONS[project.upgrade].name} ·{" "}
          {formatPercent(upgradeProgress(project, game.date.minute))} complete
        </Typography>
      ) : (
        <Typography
          variant="body2"
          color="textSecondary"
          className="facilityDetailDescription"
        >
          Build new gas turbines at this coal site.
        </Typography>
      )}
      {options.map(({ kind, quote }) => (
        <FacilityUpgradeAction
          key={kind}
          label={coalRepowerActionLabel(kind)}
          cost={quote.cost}
          shortfall={Math.max(0, quote.cost - cash)}
          onClick={() => setReview(kind)}
        />
      ))}
      {review && reviewAvailable && onRetrofit && (
        <CoalRepowerReview
          facility={facility}
          game={game}
          kind={review}
          onRetrofit={onRetrofit}
          onClose={() => setReview(undefined)}
        />
      )}
    </section>
  );
}
