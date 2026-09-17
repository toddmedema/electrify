import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../Store";
import { pendingScenarioChoice } from "../../helpers/ScenarioChoices";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { chooseScenarioResponse } from "../../reducers/GameActions";

export default function ScenarioChoiceDialog() {
  const game = useAppSelector((state) => state.game);
  const dispatch = useAppDispatch();
  const decision =
    game.inGame && !game.replayPlayback
      ? pendingScenarioChoice(game)
      : undefined;
  if (!decision) return null;
  const cash = getTimeFromTimeline(game.date.minute, game.timeline)?.cash ?? 0;
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      aria-labelledby="scenarioChoiceTitle"
      aria-describedby="scenarioChoiceDescription"
      data-scenario-choice="true"
      slotProps={{
        paper: {
          sx: {
            m: { xs: 1.5, sm: 4 },
            width: { xs: "calc(100% - 24px)", sm: "calc(100% - 64px)" },
            maxHeight: {
              xs: "calc(100dvh - 24px)",
              sm: "calc(100dvh - 64px)",
            },
          },
        },
      }}
    >
      <DialogTitle
        id="scenarioChoiceTitle"
        sx={{ "&&": { px: { xs: 2, sm: 3 }, pt: 2, pb: 1 } }}
      >
        {decision.title}
      </DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
          Game paused — choose a response to continue.
        </Typography>
        <Typography id="scenarioChoiceDescription">
          {decision.message}
        </Typography>
        <Typography sx={{ my: 2 }}>
          Cash available: ${(cash / 1000000).toFixed(1)}M
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: 2,
          }}
        >
          {decision.options.map((option, index) => {
            const cost = option.cost(game.difficulty);
            const grant = option.upfrontGrant?.(game.difficulty) || 0;
            const affordable = cost === 0 || cash >= cost;
            return (
              <Box key={option.id}>
                <Button
                  fullWidth
                  autoFocus={index === 0 && affordable}
                  variant={index === 0 ? "contained" : "outlined"}
                  disabled={!affordable}
                  aria-describedby={`scenarioChoiceOption-${option.id}`}
                  sx={{ minHeight: 44, whiteSpace: "normal" }}
                  onClick={() =>
                    dispatch(
                      chooseScenarioResponse({
                        decisionId: decision.id,
                        optionId: option.id,
                      }),
                    )
                  }
                >
                  {option.label}
                </Button>
                <Typography
                  id={`scenarioChoiceOption-${option.id}`}
                  variant="body2"
                  sx={{ color: "text.secondary", mt: 0.5 }}
                >
                  {grant > 0
                    ? `One-time funding: $${(grant / 1000000).toFixed(1)}M`
                    : cost > 0
                      ? `One-time cost: $${(cost / 1000000).toFixed(1)}M`
                      : "No upfront cost"}
                  {!affordable && " · Insufficient cash"}
                  {option.description && (
                    <Box component="span" sx={{ display: "block", mt: 1 }}>
                      {option.description}
                    </Box>
                  )}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
