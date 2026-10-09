import { Typography } from "@mui/material";
import numbro from "numbro";
import { VictoryDebriefType, VictoryType } from "../../Types";
import ConceptIcon from "./ConceptIcon";
import { formatMoneyConcise, formatScore } from "../../helpers/Format";
import { scoreLabel } from "../../helpers/Scoring";
import { formatLargeMass } from "../../helpers/Units";
import { useUnits } from "./UnitsContext";
import "./ProgressFeedback.scss";

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
    { concept: "supply" as const, label: "Demand served", value: reliability },
    {
      concept: "money" as const,
      label: "Ending cash",
      value: formatMoneyConcise(debrief.finalCash),
    },
    {
      concept: "customers" as const,
      label: "Customers",
      value: numbro(debrief.finalCustomers).format({ average: true }),
    },
    {
      concept: "danger" as const,
      label: "Emissions",
      value: formatLargeMass(debrief.kgco2e, units),
    },
  ];
  return (
    <section
      className="victoryDebrief resultDebrief"
      aria-label="Mission results"
    >
      <dl className="resultMetrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="resultMetric">
            <dt>
              <ConceptIcon concept={metric.concept} fontSize="small" />
              {metric.label}
            </dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
      {!!debrief.scenarioMetrics?.length && (
        <dl className="resultScenarioMetrics">
          {debrief.scenarioMetrics.map((metric) => (
            <div key={metric.label}>
              <dt>
                <ConceptIcon concept={metric.concept} fontSize="small" />
                {metric.label}
              </dt>
              <dd>{metric.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
