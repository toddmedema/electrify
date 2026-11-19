import * as React from "react";
import { Typography } from "@mui/material";
import {
  COAL_REPOWER_UPGRADES,
  CoalRepowerType,
  FacilityOperatingType,
  GameType,
  RetrofitFacilityAction,
  isStorage,
} from "../../Types";
import {
  COAL_REPOWER_OPTIONS,
  coalRepowerInProgress,
  coalRepowerPurchaseTerms,
  coalRepowerQuote,
} from "../../helpers/CoalRepower";
import { getInflationIndex } from "../../data/Economy";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import {
  formatBuildMonths,
  formatForecastWatts,
  formatWatts,
} from "../../helpers/Format";
import {
  estimatedAnnualOperatingCost,
  facilityLoanMonths,
} from "../../helpers/Financials";
import { currentCash } from "../../helpers/GameSelectors";
import { upgradeProgress } from "../../helpers/Hazards";
import { useCoalRepowerImpact } from "./CoalRepowerImpact";
import { useMoney } from "./CurrencyContext";
import FacilityUpgradeAction from "./FacilityUpgradeAction";
import PurchaseReviewDialog from "./PurchaseReviewDialog";
import SupplyMarginComparisonChart from "./SupplyMarginComparisonChart";

export function coalRepowerActionLabel(kind: CoalRepowerType): string {
  return `Convert to ${COAL_REPOWER_OPTIONS[kind].name}`;
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
  const quote = coalRepowerQuote(facility, game, kind);
  const impact = useCoalRepowerImpact(game, facility.id, kind);
  const { formatPricePerMWh } = useMoney();
  if (!quote || isStorage(facility)) return null;

  const { cost, durationMinutes, target } = quote;
  const margin = impact.status === "ready" ? impact.result : undefined;
  const escalation =
    getInflationIndex(game.date, game.startingYear, game.seed) /
    (facility.costIndexAtBuild || 1);
  const capacityChange =
    target.peakW !== facility.peakW
      ? ` Nameplate capacity drops from ${formatWatts(facility.peakW)} to ${formatWatts(target.peakW)}.`
      : "";
  return (
    <PurchaseReviewDialog
      open
      title={`${coalRepowerActionLabel(kind)}?`}
      cash={currentCash(game)}
      buildCost={cost}
      interestRate={game.interestRate}
      loanMonths={facilityLoanMonths(target.lifespanYears)}
      cashLabel="Cash option"
      upkeepLabel="Maintenance"
      upkeepBeforePerMonth={
        (estimatedAnnualOperatingCost(facility) * escalation) / 12
      }
      upkeepPerMonth={estimatedAnnualOperatingCost(target) / 12}
      onClose={onClose}
      onPurchase={(financed) => {
        onRetrofit({ facilityId: facility.id, upgrade: kind, financed });
        onClose();
      }}
      extraFacts={[
        {
          concept: "money",
          label: "Variable Costs",
          value: `${formatPricePerMWh((facility.variableOperatingCostPerMWh ?? 0) * escalation)} → ${formatPricePerMWh(target.variableOperatingCostPerMWh ?? 0)}`,
        },
        {
          concept: "time",
          label: "Conversion complete in",
          value: formatBuildMonths(
            durationMinutes / (12 * MINUTES_PER_MONTH),
            "long",
          ),
          detail: `Coal can keep running until the gas plant takes over.${capacityChange}`,
        },
        {
          concept: "time",
          label: "Startup time",
          value: `${facility.spinMinutes} min → ${target.spinMinutes} min`,
        },
        {
          concept: "supply",
          label: "Lowest supply margin",
          value: margin
            ? `${formatForecastWatts(margin.beforeW)} → ${formatForecastWatts(margin.afterW)}`
            : impact.status === "loading" || impact.status === "idle"
              ? "Estimating…"
              : "Forecast unavailable",
          detail: "First year after completion, without vs. with conversion.",
        },
      ]}
      afterFacts={
        <SupplyMarginComparisonChart
          forecast={margin}
          failed={impact.status === "error"}
          labels={["Without conversion", "With conversion"]}
          ariaLabel="Estimated monthly lowest supply margin with and without conversion, first year after completion"
          dateAt={(month, forecast) =>
            getDateFromMinute(
              forecast.startsMinute + month * MINUTES_PER_MONTH,
              game.startingYear,
            )
          }
          periodLabel={(date) => `${date.month} ${date.year}`}
        />
      }
    />
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
  const section = React.useRef<HTMLElement>(null);
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
    <section
      ref={section}
      tabIndex={-1}
      className="facilityDetailSection"
      aria-label="Coal repowering"
    >
      <Typography component="h3" className="facilityDetailHeading">
        Repower with natural gas
      </Typography>
      {project ? (
        <>
          <Typography variant="body2">
            {COAL_REPOWER_OPTIONS[project.upgrade].name} ·{" "}
            {Math.floor(upgradeProgress(project, game.date.minute) * 100)}%
            complete
          </Typography>
          <Typography
            variant="body2"
            color="textSecondary"
            className="facilityDetailDescription"
          >
            Cancel the conversion before selling this plant.
          </Typography>
        </>
      ) : (
        <Typography
          variant="body2"
          color="textSecondary"
          className="facilityDetailDescription"
        >
          Build new gas turbines at this coal site.
        </Typography>
      )}
      {options.map(({ kind, quote }) => {
        const { amountDue } = coalRepowerPurchaseTerms(
          quote,
          true,
          game.interestRate,
        );
        return (
          <FacilityUpgradeAction
            key={kind}
            label={coalRepowerActionLabel(kind)}
            cost={quote.cost}
            shortfall={Math.max(0, amountDue - cash)}
            onClick={() => setReview(kind)}
          />
        );
      })}
      {review && reviewAvailable && onRetrofit && (
        <CoalRepowerReview
          facility={facility}
          game={game}
          kind={review}
          onRetrofit={(payload) => {
            onRetrofit(payload);
            requestAnimationFrame(() =>
              section.current?.focus({ preventScroll: true }),
            );
          }}
          onClose={() => setReview(undefined)}
        />
      )}
    </section>
  );
}
