import { Box, Button, Stack, Typography } from "@mui/material";
import {
  LEGACY_GENERATIONS,
  legacyGenerationTitle,
} from "../../data/LegacyCampaign";
import { DifficultyType } from "../../Types";
import DifficultyPicker from "../base/DifficultyPicker";
import ScreenPage from "../base/ScreenPage";

export interface CampaignSetupProps {
  difficulty: DifficultyType;
  unlockedThrough?: DifficultyType;
  activeGeneration?: number;
  busy?: boolean;
  onDifficulty: (difficulty: DifficultyType) => void;
  onStart: () => void;
  onBack: () => void;
  onResume?: () => void;
}

export default function CampaignSetup({
  difficulty,
  unlockedThrough,
  activeGeneration,
  busy,
  onDifficulty,
  onStart,
  onBack,
  onResume,
}: CampaignSetupProps): React.JSX.Element {
  return (
    <ScreenPage
      title="Legacy campaign"
      onBack={onBack}
      className="campaignSetup"
    >
      <Box className="scrollable" sx={{ flex: 1, minHeight: 0 }}>
        <Stack className="campaignSetupContent" spacing={3} sx={{ py: 2 }}>
          <Box>
            <Typography component="h2" variant="h5" sx={{ mb: 1 }}>
              One utility. Nine generations.
            </Typography>
            <Typography>
              Lead one utility through nine 20-year CEO terms. Inspired by
              Northern California history.
            </Typography>
          </Box>
          <Box
            component="section"
            aria-label="Campaign difficulty"
            className="difficultyPicker"
          >
            <Typography component="h2" variant="subtitle1" sx={{ mb: 1 }}>
              Difficulty
            </Typography>
            <DifficultyPicker
              value={difficulty}
              onChange={onDifficulty}
              variant="toggle"
              showDescription
              readOnly={busy}
              unlockedThrough={unlockedThrough}
            />
          </Box>
          <Box component="section" aria-labelledby="campaign-terms-title">
            <Typography
              id="campaign-terms-title"
              component="h2"
              variant="subtitle1"
              sx={{ mb: 1 }}
            >
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
                  sx={{ pl: 0.5, py: 0.5 }}
                >
                  <Typography>{legacyGenerationTitle(generation)}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Stack>
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
            className="scenarioStartButton"
            variant="contained"
            disabled={busy}
            onClick={onResume}
            sx={{ minHeight: 44 }}
          >
            Resume term {activeGeneration + 1}
          </Button>
        )}
        <Button
          className="scenarioStartButton"
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
