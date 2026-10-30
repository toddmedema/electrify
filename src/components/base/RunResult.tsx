import { Box, Typography } from "@mui/material";
import { VictoryDebriefType, VictoryType } from "../../Types";
import ConceptIcon from "./ConceptIcon";
import {
  formatCustomerCount,
  formatMoneyConcise,
  formatScore,
} from "../../helpers/Format";
import { scoreLabel } from "../../helpers/Scoring";
import { formatLargeMass } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import {
  finishedObjectiveStatusText,
  objectiveDefinitionText,
  objectiveObservedText,
  objectiveTargetText,
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
}: {
  debrief: VictoryDebriefType;
}): React.JSX.Element {
  const units = useUnits();
  const reliability = `${(debrief.reliability * 100).toFixed(debrief.reliability >= 0.999 ? 2 : 1)}%`;
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
      value: formatLargeMass(debrief.kgco2e, units),
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
      {!!debrief.objectiveResults?.length && (
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
          {debrief.objectiveResults.map((result) => {
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
                  {objectiveTargetText(result.objective)} ·{" "}
                  {first === last
                    ? `Month ${first + 1}`
                    : `Months ${first + 1}–${last + 1}`}
                </Typography>
                <Typography component="p" variant="body2">
                  {objectiveObservedText(result)}
                </Typography>
                {result.reason && (
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
