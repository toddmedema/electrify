import { activeScenario, currentTick } from "../../helpers/GameSelectors";
import * as React from "react";
import { Box, Typography, useMediaQuery } from "@mui/material";
import { GameType, ScenarioType, ScoreCategoryType } from "../../Types";
import { DIFFICULTY_LABELS } from "../../Constants";
import { getScenarioLocation } from "../../helpers/Locations";
import {
  deriveExpandedSummary,
  summarizeHistory,
} from "../../helpers/DateTime";
import {
  computeScoreBreakdown,
  scoreLabel,
  scoreRuleText,
  startingDollarRevenue,
} from "../../helpers/Scoring";
import { useUnits } from "./UnitsContext";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import CustomerGrowthChallenge from "./CustomerGrowthChallenge";
import { formatScore } from "../../helpers/Format";
import { getMissionStatus } from "../../helpers/MissionStatus";
import type { MissionRequirement } from "../../helpers/MissionStatus";
import {
  projectScore,
  ScoreProjectionType,
} from "../../helpers/ScoreProjection";
import { useAppSelector } from "../../Store";
import { GameCard } from "./GameCard";
import ChartFinances from "./ChartFinances";
import {
  projectMission,
  MissionProjection,
} from "../../helpers/MissionProjection";
import {
  projectionReady,
  readProjection,
  requestProjection,
  subscribeProjection,
} from "./DeferredProjection";

function useMissionProjection(game: GameType): MissionProjection | undefined {
  const [, refresh] = React.useReducer((count: number) => count + 1, 0);
  React.useEffect(() => subscribeProjection(refresh), []);
  const now = currentTick(game);
  const ended =
    game.date.monthsElapsed >= (activeScenario(game)?.durationMonths ?? 0);
  const ready = projectionReady(game);
  React.useEffect(() => {
    if (now && !ended && !ready) requestProjection(game, now);
  }, [game, now, ended, ready]);
  if (!now || ended || (!ready && typeof Worker !== "undefined"))
    return undefined;
  return projectMission(game, readProjection(game, now));
}

const FORECAST_LABELS = {
  "on-track": "Projected to meet",
  "at-risk": "Projected miss",
  unavailable: "Forecast unavailable",
  completed: "Met",
  failed: "Failed",
};

function MissionOutlook({
  outlook,
}: {
  outlook: MissionProjection | undefined;
}): React.JSX.Element {
  const risks = outlook?.requirements
    .filter(
      (row) =>
        row.required && (row.status === "at-risk" || row.status === "failed"),
    )
    .sort(
      (a, b) =>
        Number(b.status === "failed") - Number(a.status === "failed") ||
        (a.failureMonth ?? Infinity) - (b.failureMonth ?? Infinity),
    );
  return (
    <Box
      component="section"
      aria-labelledby="scenario-result-title"
      className="scenarioMissionOutlook"
      data-status={outlook?.status ?? "loading"}
    >
      <Typography
        id="scenario-result-title"
        variant="h6"
        component="h3"
        sx={{ fontWeight: 600 }}
      >
        {!outlook
          ? "Updating forecast…"
          : outlook.status === "loss"
            ? "Projected loss"
            : outlook.status === "win"
              ? "Projected win"
              : "Forecast incomplete"}
      </Typography>
      {risks && risks.length > 0 ? (
        <Box
          component="ul"
          sx={{ m: 0, pl: 2, typography: "body2", "& li + li": { mt: 1 } }}
        >
          {risks.map((risk) => (
            <li key={risk.id}>
              <strong>{risk.label}:</strong> {risk.detail}
            </li>
          ))}
        </Box>
      ) : (
        <Typography variant="body2">
          {!outlook
            ? "Checking every goal and survival condition."
            : outlook.status === "win"
              ? "All required goals and survival conditions are projected to be met."
              : "Some goals cannot be forecast through their full required window."}
        </Typography>
      )}
      {outlook && (
        <Typography variant="body2" color="text.secondary">
          With current plans, through {outlook.through}. Hourly estimates update
          when you make changes.
        </Typography>
      )}
    </Box>
  );
}

const STATUS_LABELS: Record<MissionRequirement["status"], string> = {
  pending: "Not started",
  "in-progress": "In progress",
  completed: "Met",
  failed: "Failed",
  unknown: "Unknown",
  waived: "Waived",
};

function statusLabel(requirement: MissionRequirement): string {
  if (requirement.definition && requirement.status === "unknown")
    return "Unavailable";
  return requirement.id === "retention" && requirement.status === "failed"
    ? "Out of reach"
    : STATUS_LABELS[requirement.status];
}

/**
 * The run's score so far, drawn month by month, and where it is heading if the last year's pace
 * holds: one solid line for the record, one fainter dashed one for the projection, meeting at
 * today.
 */
function ScoreOutlook({
  projection,
  history,
}: {
  projection: ScoreProjectionType;
  history: GameType["monthlyHistory"];
}): React.JSX.Element {
  const timeline = React.useMemo(() => {
    const last = history[0];
    const first = last.year * 12 + last.month - projection.actual.length + 1;
    const point = (index: number, value: number, projected: boolean) => {
      const month = first + index;
      return { month, year: Math.floor((month - 1) / 12), value, projected };
    };
    return [
      ...projection.actual.map((value, i) => point(i, value, false)),
      ...projection.projected.map((value, i) =>
        point(projection.actual.length + i, value, true),
      ),
    ];
  }, [projection, history]);
  const current = projection.actual[projection.actual.length - 1];
  const change = projection.final - current;
  const ended = projection.projected.length === 0;
  // The chart's height scales with its width, so a phone needs more to keep its axis readable
  const phone = useMediaQuery("(max-width: 599px)");
  return (
    <Box
      component="section"
      aria-labelledby="scenario-outlook-title"
      className="scenarioOutlook"
    >
      <Typography
        id="scenario-outlook-title"
        variant="h6"
        component="h3"
        sx={{ fontWeight: 600 }}
      >
        Score outlook
      </Typography>
      <Box component="dl" className="scenarioOutlookFigures">
        <div>
          <dt>{ended ? "Final score" : "Score now"}</dt>
          <dd>{formatScore(current)}</dd>
        </div>
        {!ended && (
          <div>
            <dt>Projected final</dt>
            <dd>
              {formatScore(projection.final)}
              {change !== 0 && (
                <span
                  className="scenarioOutlookChange"
                  data-direction={change > 0 ? "up" : "down"}
                >
                  {change > 0 ? "+" : "−"}
                  {formatScore(Math.abs(change))}
                  <span className="srOnly"> from now</span>
                </span>
              )}
            </dd>
          </div>
        )}
      </Box>
      <ChartFinances
        hideTitle
        id="scenarioScoreChart"
        height={phone ? 150 : 120}
        timeline={timeline}
        title="score"
        format={formatScore}
        projectedNote="Projected"
      />
    </Box>
  );
}

/**
 * The scenario's outcome and goals lead; score remains separate from winning the term.
 */
export default function ScenarioDetails(): React.JSX.Element | null {
  const game = useAppSelector((state) => state.game);
  const scenario = activeScenario(game);
  if (!scenario) {
    return null;
  }
  return (
    <GameCard
      className="scenarioDetails"
      title="Scenario"
      id="scenarioPane"
      game={game}
    >
      <div className="scrollable">
        <ScenarioDetailsContent game={game} scenario={scenario} />
      </div>
    </GameCard>
  );
}

export function ScenarioDetailsContent({
  game,
  scenario,
}: {
  game: GameType;
  scenario: ScenarioType;
}): React.JSX.Element {
  const units = useUnits();
  const location = getScenarioLocation(scenario);
  const mission = getMissionStatus(game);
  const missionProjection = useMissionProjection(game);
  const history = game.monthlyHistory;
  // Both read only the completed months, which change once a month rather than every tick
  const breakdown = React.useMemo(
    () =>
      history.length > 0
        ? computeScoreBreakdown(
            scenario,
            deriveExpandedSummary(summarizeHistory(history)),
            startingDollarRevenue(history, game.startingYear, game.seed),
          )
        : null,
    [scenario, history, game.startingYear, game.seed],
  );
  const projection = React.useMemo(
    () => projectScore(scenario, history, game.startingYear, game.seed),
    [scenario, history, game.startingYear, game.seed],
  );
  const rules = scoreRuleText(
    scenario.ownership,
    scenario.dollarsPerkWh,
    formatLargeMassApprox(KG_PER_MEGATONNE, units),
  );
  const facts = [
    {
      label: "Timeframe",
      value: `${scenario.startingYear}–${scenario.startingYear + Math.ceil(scenario.durationMonths / 12) - 1}`,
    },
    ...(location ? [{ label: "Location", value: location.name }] : []),
    { label: "Difficulty", value: DIFFICULTY_LABELS[game.difficulty] },
    { label: "Ownership", value: `${scenario.ownership}-owned` },
  ];

  return (
    <div className="scenarioDetailsBody">
      <Typography
        variant="h6"
        component="h3"
        className="scenarioDetailsName"
        sx={{ fontWeight: 600 }}
      >
        {scenario.name}
      </Typography>
      <Box component="dl" className="scenarioFacts">
        {facts.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </Box>
      {!mission.finalNote && <MissionOutlook outlook={missionProjection} />}
      <Box component="section" aria-labelledby="scenario-rules-title">
        <Typography
          id="scenario-rules-title"
          variant="h6"
          component="h3"
          sx={{ fontWeight: 600 }}
        >
          Victory conditions
        </Typography>
        {scenario.id === 3 && <CustomerGrowthChallenge />}
        {mission.finalNote && (
          <Typography variant="body2">{mission.finalNote}</Typography>
        )}
        <Box component="dl" className="missionRequirements">
          {[...mission.requirements]
            .sort(
              (a, b) =>
                Number(a.required === false) - Number(b.required === false),
            )
            .map((requirement) => {
              const forecast = missionProjection?.requirements.find(
                (row) => row.id === requirement.id,
              );
              const showForecast =
                requirement.status !== "completed" &&
                requirement.status !== "failed" &&
                !mission.finalNote;
              return (
                <React.Fragment key={requirement.id}>
                  <Typography
                    component="dt"
                    variant="body2"
                    sx={{ mt: 2, fontWeight: 600, overflowWrap: "anywhere" }}
                  >
                    <span>
                      {requirement.definition
                        ? requirement.label
                        : requirement.target}
                    </span>
                    {requirement.required === false && (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{ ml: 1, color: "text.secondary" }}
                      >
                        Optional
                      </Typography>
                    )}
                  </Typography>
                  {requirement.definition && (
                    <Typography
                      component="dd"
                      variant="body2"
                      sx={{ color: "text.secondary", overflowWrap: "anywhere" }}
                    >
                      {requirement.definition}
                    </Typography>
                  )}
                  {requirement.definition && (
                    <Typography component="dd" variant="body2">
                      {requirement.target}
                    </Typography>
                  )}
                  <Typography component="dd" variant="body2">
                    {(requirement.status !== "unknown" ||
                      requirement.definition) &&
                      requirement.status !== "in-progress" && (
                        <span
                          className="missionRequirementStatus"
                          data-status={requirement.status}
                        >
                          {statusLabel(requirement)}
                        </span>
                      )}{" "}
                    <span>
                      {requirement.definition || requirement.id === "survival"
                        ? "Recorded: "
                        : ""}
                      {requirement.current}
                    </span>
                  </Typography>
                  {showForecast && (
                    <Typography component="dd" variant="body2">
                      <span
                        className="missionRequirementStatus"
                        data-status={forecast?.status ?? "loading"}
                      >
                        {forecast
                          ? FORECAST_LABELS[forecast.status]
                          : "Updating forecast…"}
                      </span>
                      {forecast && <span>{forecast.detail}</span>}
                    </Typography>
                  )}
                  {requirement.reason && (
                    <Typography
                      component="dd"
                      variant="body2"
                      sx={{ color: "text.secondary", overflowWrap: "anywhere" }}
                    >
                      {requirement.reason}
                    </Typography>
                  )}
                </React.Fragment>
              );
            })}
        </Box>
      </Box>
      {projection && <ScoreOutlook projection={projection} history={history} />}
      <Box
        component="section"
        aria-labelledby="scenario-score-title"
        className="scenarioBreakdown"
      >
        <Typography
          id="scenario-score-title"
          variant="h6"
          component="h3"
          sx={{ fontWeight: 600 }}
        >
          Score breakdown
        </Typography>
        {breakdown ? (
          <Box component="dl" sx={{ m: 0, mt: 1 }}>
            {Object.entries(breakdown).map(([category, score = 0]) => (
              <Box
                key={category}
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 2,
                  py: 1,
                  borderTop: "1px solid",
                  borderColor: "divider",
                  typography: "body2",
                }}
              >
                <Box>
                  <Box
                    component="dt"
                    sx={{
                      "&::first-letter": { textTransform: "uppercase" },
                    }}
                  >
                    {scoreLabel(category)}
                  </Box>
                  {rules[category as ScoreCategoryType] && (
                    <Box
                      component="dd"
                      sx={{
                        m: 0,
                        color: "text.secondary",
                        typography: "caption",
                      }}
                    >
                      {rules[category as ScoreCategoryType]}
                    </Box>
                  )}
                </Box>
                <Box
                  component="dd"
                  sx={{
                    m: 0,
                    flexShrink: 0,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color:
                      score < 0
                        ? "var(--delta-bad)"
                        : score > 0
                          ? "var(--delta-good)"
                          : "text.secondary",
                  }}
                >
                  {score > 0 ? "+" : ""}
                  {formatScore(score)}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ mt: 1, color: "text.secondary" }}>
            Score appears after your first month.
          </Typography>
        )}
      </Box>
    </div>
  );
}
