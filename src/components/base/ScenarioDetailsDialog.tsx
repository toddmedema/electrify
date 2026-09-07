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
import { summarizeHistory } from "../../helpers/DateTime";
import { computeScoreBreakdown, totalScore } from "../../helpers/Scoring";
import VictoryConditions from "./VictoryConditions";
import CustomerGrowthChallenge from "./CustomerGrowthChallenge";
import { formatScore, SCORE_LABELS } from "./VictoryDialog";

export interface Props {
  open: boolean;
  game: GameType;
  onClose: () => void;
}

/** An in-game reminder of the mission and its score through completed months. */
export default function ScenarioDetailsDialog(props: Props): React.JSX.Element {
  const { open, game, onClose } = props;
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (!scenario) {
    return <Dialog open={false} />;
  }
  const location = getScenarioLocation(scenario);
  const history = game.monthlyHistory;
  const breakdown =
    history.length > 0
      ? computeScoreBreakdown(scenario, summarizeHistory(history))
      : null;
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
          <DialogTitle
            id="scenario-details-title"
            sx={{
              "&&": { p: 0 },
              mt: 0.5,
              fontSize: { xs: 24, sm: 28 },
              fontWeight: 700,
              lineHeight: 1.2,
              overflowWrap: "anywhere",
            }}
          >
            {scenario.name}
          </DialogTitle>
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
            <Box
              sx={{
                typography: "body2",
                "& p": {
                  my: 0,
                  py: 1.5,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                },
                "& p:last-child": { borderBottom: 0, pb: 0 },
              }}
            >
              <VictoryConditions
                ownership={scenario.ownership}
                dollarsPerkWh={scenario.dollarsPerkWh}
                startingCustomers={scenario.startingCustomers}
                minimumCustomerRetention={scenario.minimumCustomerRetention}
                reliabilityObjective={scenario.reliabilityObjective}
              />
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
                <Typography variant="body2" color="text.secondary">
                  Through last month · updates monthly
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
                      <Box
                        component="dt"
                        sx={{
                          "&::first-letter": { textTransform: "uppercase" },
                        }}
                      >
                        {SCORE_LABELS[category] || category}
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
                Your score will appear after the first month. Use the victory
                conditions to plan your opening moves.
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
