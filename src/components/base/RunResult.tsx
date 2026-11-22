import {
  currencyByCode,
  currencyForLocation,
  USD_CURRENCY,
} from "../../helpers/Currency";
import { getScenarioLocation } from "../../helpers/Locations";
import { useMoney } from "./CurrencyContext";
import { getScenario } from "../../data/Scenarios";
import { Box, Typography } from "@mui/material";
import { VictoryDebriefType, VictoryType } from "../../Types";
import ConceptIcon from "./ConceptIcon";
import {
  formatCustomerCount,
  formatScore,
  formatPercent,
} from "../../helpers/Format";
import { scoreLabel } from "../../helpers/Scoring";
import { formatLargeMassSignificant } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import FinishedObjective from "./FinishedObjective";

export function resultTitle(
  result: Pick<VictoryType, "outcome" | "endTitle">,
): string {
  if (result.outcome === "bankrupt" || result.outcome === "fired") {
    return (
      result.endTitle ||
      (result.outcome === "bankrupt" ? "Bankrupt!" : "Fired!")
    );
  }
  return !result.endTitle ||
    /^mission complete!?$/i.test(result.endTitle.trim())
    ? "Mission complete"
    : result.endTitle;
}

export function ResultScore({
  result,
}: {
  result: Pick<VictoryType, "score" | "breakdown">;
}): React.JSX.Element {
  const summary = Object.entries(result.breakdown)
    .map(
      ([category, points = 0]) =>
        `${points > 0 ? "+" : ""}${formatScore(points)} ${scoreLabel(category)}`,
    )
    .join(" · ");
  return (
    <>
      <Typography
        className="victoryScore"
        variant="h4"
        component="p"
        aria-label={`Final score ${formatScore(result.score)} points`}
      >
        <strong>{formatScore(result.score)}</strong> points
      </Typography>
      <Typography
        className="victoryScoreBreakdown"
        variant="body2"
        color="text.secondary"
      >
        {summary}
      </Typography>
    </>
  );
}

export function RunDebrief({
  debrief,
  scenarioId,
  outcome,
  leadMessage,
  compact = false,
}: {
  debrief: VictoryDebriefType;
  scenarioId?: number;
  outcome: VictoryType["outcome"];
  /** The ending already stated above the debrief, so a lone objective doesn't repeat it */
  leadMessage?: string;
  /** The live end-game modal omits repeated headline metrics. */
  compact?: boolean;
}): React.JSX.Element {
  const units = useUnits();
  const objectiveResults =
    outcome === "bankrupt" || outcome === "fired"
      ? debrief.objectiveResults
      : undefined;
  // Dates rather than month indexes wherever the scenario's calendar is known; a custom game's
  // scenario isn't recorded with the result, so it keeps the month count.
  const scenario =
    scenarioId === undefined ? undefined : getScenario(scenarioId);
  const currency = debrief.currencyCode
    ? currencyByCode(debrief.currencyCode)
    : scenario
      ? currencyForLocation(
          getScenarioLocation(scenario),
          scenario.startingYear,
        )
      : USD_CURRENCY;
  const { formatMoneyConcise } = useMoney(currency);
  const roundedReliability = formatPercent(debrief.reliability, 2);
  const reliability =
    debrief.reliability < 1 && roundedReliability === "100%"
      ? "<100%"
      : roundedReliability;
  const metrics = [
    ...(compact
      ? []
      : [
          { concept: "supply" as const, label: "served", value: reliability },
          {
            concept: "money" as const,
            label: "cash",
            value: formatMoneyConcise(debrief.finalCash),
          },
        ]),
    {
      concept: "customers" as const,
      label: "customers",
      value: formatCustomerCount(debrief.finalCustomers),
    },
    {
      concept: "danger" as const,
      label: "emissions",
      value: formatLargeMassSignificant(debrief.kgco2e, units),
    },
    ...(debrief.scenarioMetrics || []).filter(
      (metric) =>
        !compact ||
        !["net income", "demand served"].includes(metric.label.toLowerCase()),
    ),
  ];
  return (
    <section className="victoryDebrief" aria-label="Mission results">
      {metrics.map((metric) => (
        <div key={metric.label} className="victoryMetric">
          {(compact || metric.concept !== "money") && (
            <ConceptIcon concept={metric.concept} fontSize="small" />
          )}
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
        </div>
      ))}
      {!!objectiveResults?.length && (
        <Box
          component="section"
          aria-label="Objective results"
          sx={{ gridColumn: "1 / -1", mt: 1, minWidth: 0 }}
        >
          <Typography
            component="h3"
            variant="subtitle1"
            sx={{ fontWeight: 600 }}
          >
            Objectives
          </Typography>
          {objectiveResults.map((result) => (
            <FinishedObjective
              key={result.id}
              result={result}
              calendar={scenario}
              currency={currency}
              leadMessage={
                objectiveResults.length === 1 ? leadMessage : undefined
              }
            />
          ))}
        </Box>
      )}
    </section>
  );
}
