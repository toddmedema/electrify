import { activeScenario } from "../../helpers/GameSelectors";
import * as React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useMediaQuery,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
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
import ChartFinances from "./ChartFinances";

export interface Props {
  open: boolean;
  game: GameType;
  onClose: () => void;
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
  return requirement.id === "retention" && requirement.status === "failed"
    ? "Out of reach"
    : STATUS_LABELS[requirement.status];
}

/**
 * The run's score so far, drawn month by month, and where it is heading if the last year's pace
 * holds: one solid line for the record, one dashed for the projection, meeting at today.
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
        height={phone ? 150 : 110}
        timeline={timeline}
        title="score"
        format={formatScore}
        projectedNote="Projected"
      />
      {!ended && (
        <Typography
          variant="caption"
          component="p"
          className="scenarioOutlookNote"
          sx={{ color: "text.secondary" }}
        >
          {projection.basisMonths < 12
            ? `An early estimate from your first ${projection.basisMonths} month${projection.basisMonths === 1 ? "" : "s"}`
            : "Projected if the last 12 months’ pace holds"}
          . Solid: your record. Dashed: the projection.
        </Typography>
      )}
    </Box>
  );
}

/** An in-game reminder of the mission and its score through completed months. */
export default function ScenarioDetailsDialog(props: Props): React.JSX.Element {
  const { open, game, onClose } = props;
  const scenario = activeScenario(game);
  if (!scenario) {
    return <Dialog open={false} />;
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="scenario-details-title"
      fullWidth
      maxWidth="md"
      slotProps={{
        paper: {
          sx: {
            maxWidth: 840,
            backgroundImage: "none",
            "@media (max-width: 599px)": {
              m: 0,
              width: "100%",
              maxWidth: "100%",
              height: "100dvh",
              maxHeight: "100dvh",
              borderRadius: 0,
            },
          },
        },
      }}
    >
      <ScenarioDetailsContent
        game={game}
        scenario={scenario}
        onClose={onClose}
      />
    </Dialog>
  );
}

// Dialog mounts this work only while visible, including its exit transition. Keeping the
// calculations inside the child avoids scanning the run's history on every closed-dialog tick.
function ScenarioDetailsContent({
  game,
  scenario,
  onClose,
}: Omit<Props, "open"> & { scenario: ScenarioType }): React.JSX.Element {
  const units = useUnits();
  const location = getScenarioLocation(scenario);
  const mission = getMissionStatus(game);
  const history = game.monthlyHistory;
  const summary =
    history.length > 0
      ? deriveExpandedSummary(summarizeHistory(history))
      : null;
  const breakdown = summary
    ? computeScoreBreakdown(
        scenario,
        summary,
        startingDollarRevenue(history, game.startingYear, game.seed),
      )
    : null;
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
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minHeight: 56,
          pl: 2,
          pr: 1,
          gap: 1,
          flexShrink: 0,
        }}
      >
        <DialogTitle
          id="scenario-details-title"
          sx={{
            "&&": { p: 0 },
            flex: 1,
            minWidth: 0,
            typography: "h6",
            overflowWrap: "anywhere",
          }}
        >
          {scenario.name}
        </DialogTitle>
        <IconButton
          aria-label="Close scenario details"
          onClick={onClose}
          color="primary"
          size="large"
          sx={{ flexShrink: 0 }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent dividers sx={{ p: { xs: 2, sm: 3 } }}>
        <Box
          component="dl"
          sx={{
            m: 0,
            mb: 3,
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, minmax(0, 1fr))",
              sm: "repeat(4, minmax(0, 1fr))",
            },
            gap: 2,
          }}
        >
          {facts.map(({ label, value }) => (
            <Box key={label} sx={{ minWidth: 0 }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="body2"
                sx={{
                  m: 0,
                  mt: 0.5,
                  fontWeight: 600,
                  overflowWrap: "anywhere",
                }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        {projection && (
          <ScoreOutlook projection={projection} history={history} />
        )}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(0, 1.2fr) minmax(0, 1fr)",
            },
            gap: 3,
            alignItems: "start",
          }}
        >
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
            <Typography variant="body2">
              {mission.monthsRemaining} months remaining. {mission.finalNote}
            </Typography>
            <Box component="dl" className="missionRequirements">
              {mission.requirements.map((requirement) => (
                <React.Fragment key={requirement.id}>
                  <Typography
                    component="dt"
                    variant="body2"
                    sx={{ mt: 2, fontWeight: 600 }}
                  >
                    {requirement.target}
                  </Typography>
                  <Typography component="dd" variant="body2">
                    {requirement.status !== "unknown" &&
                      requirement.status !== "in-progress" && (
                        <span
                          className="missionRequirementStatus"
                          data-status={requirement.status}
                        >
                          {statusLabel(requirement)}
                        </span>
                      )}{" "}
                    <span>{requirement.current}</span>
                  </Typography>
                </React.Fragment>
              ))}
            </Box>
          </Box>
          <Box
            component="section"
            aria-labelledby="scenario-score-title"
            sx={{
              p: 2,
              bgcolor: "var(--bg-raised)",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "var(--radius-lg)",
            }}
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
              <>
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
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Score appears after your first month.
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          px: { sm: 3 },
          pb: "max(16px, env(safe-area-inset-bottom))",
        }}
      >
        <Button
          color="primary"
          variant="contained"
          onClick={onClose}
          sx={{
            minHeight: 40,
            width: { xs: "100%", sm: "auto" },
            "@media (pointer: coarse)": { minHeight: 44 },
          }}
        >
          Back to game
        </Button>
      </DialogActions>
    </>
  );
}
