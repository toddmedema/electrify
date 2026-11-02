import { Box, Button, Divider, Stack, Typography } from "@mui/material";
import {
  LEGACY_GENERATIONS,
  LEGACY_SCENARIOS,
} from "../../data/LegacyCampaign";
import { DifficultyType } from "../../Types";
import { formatCustomerCount, formatWatts } from "../../helpers/Format";
import DifficultyPicker from "../base/DifficultyPicker";
import ScreenPage from "../base/ScreenPage";

export interface CampaignSetupProps {
  difficulty: DifficultyType;
  activeGeneration?: number;
  busy?: boolean;
  onDifficulty: (difficulty: DifficultyType) => void;
  onStart: () => void;
  onBack: () => void;
  onResume?: () => void;
}

export default function CampaignSetup({
  difficulty,
  activeGeneration,
  busy,
  onDifficulty,
  onStart,
  onBack,
  onResume,
}: CampaignSetupProps): React.JSX.Element {
  const opening = LEGACY_SCENARIOS[0];
  return (
    <ScreenPage title="Legacy campaign" onBack={onBack}>
      <Box className="scrollable" sx={{ flex: 1, minHeight: 0 }}>
        <Box sx={{ maxWidth: 720, mx: "auto", p: { xs: 2, sm: 3 } }}>
          <Typography variant="overline" color="text.secondary">
            Northern California · 1882–2061
          </Typography>
          <Typography component="h2" variant="h5" sx={{ mt: 0.5, mb: 1 }}>
            One utility. Nine generations.
          </Typography>
          <Typography sx={{ mb: 2 }}>
            Begin with a small steam generator and lead nine 20-year CEO terms.
            Each successor inherits your plants, customers, cash, and debt.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Your first grid:{" "}
            {formatCustomerCount(opening.startingCustomers ?? 100)} customers, a{" "}
            {formatWatts(opening.facilities[0].peakW ?? 0)} steam generator, and
            an opening price of ${opening.dollarsPerkWh.toFixed(2)}/kWh.
          </Typography>
          <Box
            component="section"
            aria-label="Campaign difficulty"
            sx={{ mb: 3 }}
          >
            <Typography component="h3" variant="subtitle1" sx={{ mb: 1 }}>
              Difficulty
            </Typography>
            <DifficultyPicker
              value={difficulty}
              onChange={onDifficulty}
              variant="select"
              showDescription
              readOnly={busy}
            />
          </Box>
          <Divider />
          <Typography component="h3" variant="subtitle1" sx={{ mt: 2, mb: 1 }}>
            Your CEO terms
          </Typography>
          <Box
            component="ol"
            aria-label="Campaign generations"
            sx={{ m: 0, pl: 3 }}
          >
            {LEGACY_GENERATIONS.map((generation) => (
              <Box
                component="li"
                key={generation.scenarioId}
                sx={{ pl: 0.5, py: 1.5 }}
              >
                <Typography component="h4" variant="subtitle2">
                  {generation.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {generation.startYear}–{generation.startYear + 19}
                </Typography>
                <Typography variant="body2">{generation.summary}</Typography>
              </Box>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Use the normal speed controls between turning points. The game
            pauses at each CEO handover. This fictional utility is inspired by
            Northern California history. Early weather and prices are modeled;
            future decades use scenario assumptions.
          </Typography>
        </Box>
      </Box>
      <Stack
        component="footer"
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{
          p: 2,
          borderTop: 1,
          borderColor: "divider",
          justifyContent: "center",
        }}
      >
        {onResume && activeGeneration !== undefined && (
          <Button
            variant="contained"
            disabled={busy}
            onClick={onResume}
            sx={{ minHeight: 44 }}
          >
            Resume generation {activeGeneration + 1}
          </Button>
        )}
        <Button
          variant={onResume ? "outlined" : "contained"}
          disabled={busy}
          onClick={onStart}
          sx={{ minHeight: 44 }}
        >
          {onResume ? "Start new campaign" : "Start campaign"}
        </Button>
      </Stack>
    </ScreenPage>
  );
}
