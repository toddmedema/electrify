import { getScenario } from "../../data/Scenarios";
import { Box, Typography } from "@mui/material";
import { VictoryDebriefType, VictoryType } from "../../Types";
import ConceptIcon from "./ConceptIcon";
import {
  formatCustomerCount,
  formatMoneyConcise,
  formatScore,
  formatPercent,
} from "../../helpers/Format";
import { scoreLabel } from "../../helpers/Scoring";
import { formatLargeMassSignificant } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import {
  finishedObjectiveStatusText,
  objectiveDefinitionText,
  objectiveObservedText,
  objectiveTargetText,
  objectiveGoalText,
} from "../../helpers/ObjectivePresentation";

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
}: {
  debrief: VictoryDebriefType;
  scenarioId?: number;
  outcome: VictoryType["outcome"];
  /** The ending already stated above the debrief, so a lone objective doesn't repeat it */
  leadMessage?: string;
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
  const reliability = formatPercent(debrief.reliability, 2);
  const metrics = [
    { concept: "supply" as const, label: "served", value: reliability },
    {
      concept: "money" as const,
      label: "cash",
      value: formatMoneyConcise(debrief.finalCash),
    },
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
    ...(debrief.scenarioMetrics || []).map((metric) => ({
      concept: metric.concept,
      label: metric.label,
      value: metric.value,
    })),
  ];
  return (
    <section className="victoryDebrief" aria-label="Mission results">
      {metrics.map((metric) => (
        <div key={metric.label} className="victoryMetric">
          <ConceptIcon concept={metric.concept} fontSize="small" />
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
          {objectiveResults.map((result) => {
            // With one objective the ending above already gives its reason; with several,
            // each keeps its own so the player can tell which one the ending meant.
            const repeatsLead = objectiveResults.length === 1;
            const first =
              "fromMonth" in result.objective
                ? result.objective.fromMonth
                : result.objective.deadlineMonth;
            const last =
              "throughMonth" in result.objective
                ? result.objective.throughMonth
                : result.metric === "fuelRetirement"
                  ? first + result.requiredMonths - 1
                  : first;
            return (
              <Box
                key={result.id}
                sx={{ mt: 1.5, overflowWrap: "anywhere" }}
                data-objective-status={result.status}
              >
                <Typography
                  component="p"
                  variant="body2"
                  sx={{ fontWeight: 600 }}
                >
                  {result.label} · {result.required ? "Required" : "Optional"} ·{" "}
                  {finishedObjectiveStatusText[result.status]}
                </Typography>
                <Typography
                  component="p"
                  variant="body2"
                  color="text.secondary"
                >
                  {objectiveDefinitionText(result)}
                </Typography>
                <Typography component="p" variant="body2">
                  {scenario !== undefined ? (
                    objectiveGoalText(
                      result.objective,
                      scenario.startingYear,
                      scenario.durationMonths,
                      (scenario.startingMonth ?? 1) - 1,
                    )
                  ) : result.objective.checkpoint ? (
                    objectiveTargetText(result.objective)
                  ) : (
                    <>
                      {objectiveTargetText(result.objective)} ·{" "}
                      {first === last
                        ? `Month ${first + 1}`
                        : `Months ${first + 1}–${last + 1}`}
                    </>
                  )}
                </Typography>
                <Typography component="p" variant="body2">
                  {objectiveObservedText(result)}
                </Typography>
                {result.reason &&
                  !(repeatsLead && leadMessage?.includes(result.reason)) && (
                    <Typography
                      component="p"
                      variant="body2"
                      color="text.secondary"
                    >
                      {result.reason}
                    </Typography>
                  )}
              </Box>
            );
          })}
        </Box>
      )}
    </section>
  );
}
