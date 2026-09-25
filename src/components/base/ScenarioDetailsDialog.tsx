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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { GameType } from "../../Types";
import { getScenario } from "../../data/Scenarios";
import { getScenarioLocation } from "../../helpers/Locations";
import {
  deriveExpandedSummary,
  summarizeHistory,
} from "../../helpers/DateTime";
import { computeScoreBreakdown, totalScore } from "../../helpers/Scoring";
import { scoreRules } from "./VictoryConditions";
import { useUnits } from "./UnitsContext";
import { formatLargeMassApprox, KG_PER_MEGATONNE } from "../../helpers/Units";
import CustomerGrowthChallenge from "./CustomerGrowthChallenge";
import { formatScore, SCORE_LABELS } from "./VictoryDialog";
import { getMissionStatus } from "../../helpers/MissionStatus";
import type { MissionRequirement } from "../../helpers/MissionStatus";

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

function statusLabel(status: MissionRequirement["status"]): string {
  return STATUS_LABELS[status];
}

/** An in-game reminder of the mission and its score through completed months. */
export default function ScenarioDetailsDialog(props: Props): React.JSX.Element {
  const { open, game, onClose } = props;
  const units = useUnits();
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) {
    return <Dialog open={false} />;
  }
  const location = getScenarioLocation(scenario);
  const mission = getMissionStatus(game);
  const history = game.monthlyHistory;
  const summary =
    history.length > 0
      ? deriveExpandedSummary(summarizeHistory(history))
      : null;
  const breakdown = summary ? computeScoreBreakdown(scenario, summary) : null;
  const rules = scoreRules(
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
    { label: "Difficulty", value: game.difficulty },
    { label: "Ownership", value: `${scenario.ownership}-owned` },
  ];

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
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          p: { xs: 2, sm: 3 },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ lineHeight: 1.5 }}
          >
            Scenario details
          </Typography>
        </Box>
        <IconButton
          aria-label="Close scenario details"
          onClick={onClose}
          sx={{
            width: 40,
            height: 40,
            "@media (pointer: coarse)": { width: 44, height: 44 },
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <DialogContent dividers sx={{ p: { xs: 2, sm: 3 } }}>
        <DialogTitle
          id="scenario-details-title"
          sx={{
            "&&": { p: 0 },
            mb: 2,
            fontSize: { xs: 24, sm: 28 },
            fontWeight: 700,
            lineHeight: 1.2,
            overflowWrap: "anywhere",
          }}
        >
          {scenario.name}
        </DialogTitle>
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
              sx={{ fontWeight: 700 }}
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
                  <Typography component="dt" sx={{ mt: 2, fontWeight: 700 }}>
                    {requirement.label}{" "}
                    <span
                      className="missionRequirementStatus"
                      data-status={requirement.status}
                    >
                      {statusLabel(requirement.status)}
                    </span>
                  </Typography>
                  <Typography component="dd">{requirement.current}</Typography>
                  <Typography
                    component="dd"
                    className="missionRequirementTarget"
                  >
                    {requirement.target}
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
              borderRadius: 2,
            }}
          >
            <Typography
              id="scenario-score-title"
              variant="h6"
              component="h3"
              sx={{ fontWeight: 700 }}
            >
              Current score
            </Typography>
            {breakdown ? (
              <>
                <Typography
                  component="p"
                  sx={{ mt: 1, mb: 0.5, fontVariantNumeric: "tabular-nums" }}
                >
                  <Box
                    component="strong"
                    sx={{ fontSize: 36, lineHeight: 1.2 }}
                  >
                    {formatScore(totalScore(breakdown))}
                  </Box>{" "}
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    points
                  </Box>
                </Typography>
                <Box component="dl" sx={{ m: 0, mt: 2 }}>
                  {Object.entries(breakdown).map(([category, score]) => (
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
                          {SCORE_LABELS[category] || category}
                        </Box>
                        {rules[category] && (
                          <Box
                            component="dd"
                            sx={{
                              m: 0,
                              color: "text.secondary",
                              typography: "caption",
                            }}
                          >
                            {rules[category]}
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
    </Dialog>
  );
}
