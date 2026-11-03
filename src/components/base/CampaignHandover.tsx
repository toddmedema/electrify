import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import {
  LEGACY_GENERATIONS,
  legacyGenerationTitle,
} from "../../data/LegacyCampaign";
import { formatNumber } from "../../helpers/Format";
import {
  finishedObjectiveStatusText,
  objectiveGoalText,
  objectiveTargetText,
  objectiveWindowText,
} from "../../helpers/ObjectivePresentation";
import type { CompiledRuleObjective } from "../../data/ScenarioRules";
import { LegacyCampaignTermType } from "../../Types";

const goalText = (
  objective: CompiledRuleObjective,
  startingYear: number,
): string => {
  const window = objectiveWindowText(objective, startingYear, 240);
  switch (objective.metric) {
    case "customerRetention":
      return `Retain ${formatNumber(objective.minRetainedShare, { style: "percent" })} of customers`;
    case "fuelRetirement":
      return objective.label;
    case "financialCoverage":
      return objective.minCoverage === 1
        ? `${objective.basis === "revenue" ? "Revenue covers operating costs" : "Cash covers monthly operating costs"} · ${window}`
        : objectiveGoalText(objective, startingYear, 240);
    case "monthEndDebt":
      return `Debt ≤$${formatNumber(Math.floor(objective.maxDebt), { maximumFractionDigits: 0 })} · ${window}`;
    case "monthlyBilledRate":
      return `Billed rate ≤$${formatNumber(Math.floor(objective.maxDollarsPerKWh * 1e6) / 1e6, { maximumFractionDigits: 6 })}/kWh · ${window}`;
    case "emissionsBudget":
      return `Emit ≤${formatNumber(Math.floor(objective.budgetKgCO2e / 1000), { maximumFractionDigits: 0 })} tonnes CO₂e this term`;
    case "emissionsPerDeliveredMWh":
      return `Emit ${objectiveTargetText(objective)} · ${window}`;
    case "efficiencySavings":
      return `Save ≥${formatNumber(objective.minShare, { style: "percent" })} of home and business electricity · ${window}`;
    default:
      return objectiveGoalText(objective, startingYear, 240);
  }
};

export interface CampaignHandoverProps {
  term: LegacyCampaignTermType;
  nextObjectives: CompiledRuleObjective[];
  busy?: boolean;
  onContinue: () => void;
  onExit: () => void;
}

export default function CampaignHandover({
  term,
  nextObjectives,
  busy,
  onContinue,
  onExit,
}: CampaignHandoverProps): React.JSX.Element {
  const next = LEGACY_GENERATIONS[term.generationIndex + 1];
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="campaign-handover-title"
      slotProps={{
        paper: {
          sx: {
            m: 1.5,
            width: "calc(100% - 24px)",
            maxHeight: "calc(100% - 24px)",
          },
        },
      }}
    >
      <DialogTitle id="campaign-handover-title" sx={{ p: 2, pb: 1 }}>
        Term {term.generationIndex + 1} complete
      </DialogTitle>
      <DialogContent sx={{ px: 2, pb: 3 }}>
        <Box
          component="ul"
          aria-label="Term results"
          sx={{
            listStyle: "none",
            p: 0,
            mt: 2,
            mb: 3,
            display: "grid",
            gap: 1.5,
          }}
        >
          {term.objectiveResults.map((result) => {
            const StatusIcon =
              result.status === "completed"
                ? CheckCircleIcon
                : result.status === "failed"
                  ? HighlightOffIcon
                  : RadioButtonUncheckedIcon;
            return (
              <Box
                component="li"
                key={result.id}
                sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}
              >
                <StatusIcon
                  titleAccess={finishedObjectiveStatusText[result.status]}
                  color={
                    result.status === "completed"
                      ? "success"
                      : result.status === "failed"
                        ? "error"
                        : "disabled"
                  }
                  sx={{ fontSize: 20, flexShrink: 0, mt: "1px" }}
                />
                <Typography>
                  {goalText(
                    result.objective,
                    LEGACY_GENERATIONS[term.generationIndex].startYear,
                  )}
                </Typography>
              </Box>
            );
          })}
        </Box>
        <Typography component="h3" variant="subtitle1">
          Next: {legacyGenerationTitle(next)}
        </Typography>
        <Box
          component="ul"
          aria-label="Next term goals"
          sx={{
            listStyle: "none",
            p: 0,
            mt: 1.5,
            mb: 0,
            display: "grid",
            gap: 1.5,
          }}
        >
          {nextObjectives.map((objective, index) => (
            <Box
              component="li"
              key={objective.id}
              sx={{ display: "flex", gap: 1 }}
            >
              <RadioButtonUncheckedIcon
                aria-hidden="true"
                sx={{
                  fontSize: 20,
                  flexShrink: 0,
                  mt: "1px",
                  color: "text.secondary",
                }}
              />
              <Typography
                color={index === 0 ? "text.primary" : "text.secondary"}
              >
                {goalText(objective, next.startYear)}
              </Typography>
            </Box>
          ))}
        </Box>
        {nextObjectives.some(
          ({ metric }) =>
            metric === "monthlyBilledRate" || metric === "monthEndDebt",
        ) && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1.5 }}
          >
            {nextObjectives.some(({ metric }) => metric === "monthlyBilledRate")
              ? "Rate and debt limits"
              : "Debt limits"}{" "}
            use 1882 dollars.
          </Typography>
        )}
      </DialogContent>
      <DialogActions
        className="campaignHandoverActions"
        sx={{
          p: 2,
          gap: 1,
          "& button": {
            m: "0 !important",
            minHeight: 44,
            whiteSpace: "nowrap",
          },
        }}
      >
        <Button disabled={busy} onClick={onExit}>
          Save &amp; exit
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={onContinue}
          autoFocus
        >
          Begin next term
        </Button>
      </DialogActions>
    </Dialog>
  );
}
