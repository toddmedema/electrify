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
import { finishedObjectiveStatusText } from "../../helpers/ObjectivePresentation";
import { LegacyCampaignTermType } from "../../Types";

export interface CampaignHandoverProps {
  term: LegacyCampaignTermType;
  busy?: boolean;
  onContinue: () => void;
  onExit: () => void;
}

export default function CampaignHandover({
  term,
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
          sx={{ listStyle: "none", p: 0, my: 2, display: "grid", gap: 1.5 }}
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
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
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
                  sx={{ fontSize: 20, flexShrink: 0 }}
                />
                <Typography>
                  {result.metric === "customerRetention"
                    ? `Retain ${formatNumber(result.target, { style: "percent" })} of customers`
                    : result.label}
                </Typography>
              </Box>
            );
          })}
        </Box>
        <Typography component="h3" variant="subtitle1">
          Next: {legacyGenerationTitle(next)}
        </Typography>
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
