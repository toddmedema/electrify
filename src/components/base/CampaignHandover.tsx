import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { LEGACY_GENERATIONS } from "../../data/LegacyCampaign";
import { formatMoneyConcise } from "../../helpers/Format";
import { LegacyCampaignTermType } from "../../Types";
import { RunDebrief } from "./RunResult";
import CampaignGoalBasis from "./CampaignGoalBasis";

export interface CampaignHandoverProps {
  term: LegacyCampaignTermType;
  facilityCount: number;
  busy?: boolean;
  onContinue: () => void;
  onExit: () => void;
}

export default function CampaignHandover({
  term,
  facilityCount,
  busy,
  onContinue,
  onExit,
}: CampaignHandoverProps): React.JSX.Element {
  const generation = LEGACY_GENERATIONS[term.generationIndex];
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
            maxWidth: "calc(100% - 24px)",
            maxHeight: "calc(100% - 24px)",
          },
        },
      }}
    >
      <DialogTitle id="campaign-handover-title">
        Generation {term.generationIndex + 1} complete
      </DialogTitle>
      <DialogContent>
        <Typography component="h2" variant="h6">
          {generation.name}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {generation.startYear}–{generation.startYear + 19}
        </Typography>
        <RunDebrief
          debrief={{ ...term.debrief, objectiveResults: term.objectiveResults }}
        />
        <CampaignGoalBasis
          scenarioId={term.scenarioId}
          results={term.objectiveResults}
        />
        <Box
          component="section"
          aria-label="Your successor inherits"
          sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: "divider" }}
        >
          <Typography component="h3" variant="subtitle1">
            Your successor inherits
          </Typography>
          <Typography>
            {facilityCount} {facilityCount === 1 ? "facility" : "facilities"}{" "}
            and {formatMoneyConcise(term.closingDebt)} in outstanding loans,
            along with your customers, cash, and commitments.
          </Typography>
          <Typography component="h3" variant="subtitle1" sx={{ mt: 2 }}>
            Next: {next.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {next.startYear}–{next.startYear + 19} · {next.summary}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          gap: 1,
          flexDirection: { xs: "column-reverse", sm: "row" },
          "& button": {
            m: "0 !important",
            minHeight: 44,
            width: { xs: "100%", sm: "auto" },
          },
        }}
      >
        <Button disabled={busy} onClick={onExit}>
          Save and exit
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={onContinue}
          autoFocus
        >
          Begin next CEO term
        </Button>
      </DialogActions>
    </Dialog>
  );
}
